import { DEFAULTS } from "../config/defaults";
import { getDefaultModel } from "../config/env";
import type { OriClient } from "../runtime/ori-client";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OriMessage,
  ScratchpadState,
} from "../runtime/types";
import {
  AGENT_TOOLS,
  type AgentToolExecution,
  executeToolCall,
} from "./tools";
import {
  type AgentMode,
  createThoughtFrame,
  createTranscriptEntry,
  type SessionState,
  type TranscriptEntry,
} from "./turn-state";
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from "../session/workspace";
import type { Bundle } from "../tools/bundles";

export type BuiltTurn = {
  mode: AgentMode;
  objective: string;
  pendingPlan: string[];
  request: ChatCompletionRequest;
  resolvedProfile: string;
};

export type ExecutedTurn = {
  response: ChatCompletionResponse;
  toolExecutions: AgentToolExecution[];
};

export async function refreshWorkspace(): Promise<WorkspaceSnapshot> {
  return loadWorkspaceSnapshot(process.cwd());
}

export function buildTurn(input: {
  input: string;
  mode: string;
  previousObjective: string | null;
  profile: string;
  transcript: OriMessage[];
  workspace: WorkspaceSnapshot | null;
  activeBundles?: Bundle[];
}): BuiltTurn {
  const mode = (input.mode as AgentMode) || "build";
  const objective = input.input.slice(0, 100);
  const cwd = input.workspace?.cwd || process.cwd();

  let systemPrompt = `You are ORI, a sovereign coding agent powered by Thynaptic.
Current Mode: ${mode}
Current Profile: ${input.profile}
Current Workspace: ${cwd}

GROUNDING RULES:
1. You are running as a local-first development tool (ORI Code).
2. Strictly focus on the local filesystem and the current repository context.
3. Do not recite broad VPS infrastructure, global host configurations, or unrelated system metadata unless explicitly asked to inspect the host environment.
4. Your primary mission is to understand, plan, and execute changes within the current workspace path: ${cwd}.
5. Be extremely concise and direct.
6. DO NOT NARRATE your tool usage or internal reasoning steps in your final response to the user. (e.g. avoid "I have checked the files and found..."). Just state the findings or provide the answer directly.
`;
  
  if (input.activeBundles && input.activeBundles.length > 0) {
    systemPrompt += "\n\nActive Specializations (Bundles):";
    for (const bundle of input.activeBundles) {
      systemPrompt += `\n\n--- BUNDLE: ${bundle.manifest.name} ---\n${bundle.rules}`;
    }
  }

  const messages: OriMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...input.transcript,
    { role: "user", content: input.input },
  ];

  return {
    mode,
    objective,
    pendingPlan: [],
    request: {
      model: getDefaultModel(),
      messages,
    },
    resolvedProfile: input.profile,
  };
}

export async function executeTurn(input: {
  client: OriClient;
  cwd?: string;
  sessionId: string;
  workspace?: WorkspaceSnapshot | null;
  surface: string;
  turn: BuiltTurn;
  onStep?: (title: string) => void;
}): Promise<ExecutedTurn> {
  const toolExecutions: AgentToolExecution[] = [];
  const messages: OriMessage[] = [...input.turn.request.messages];
  const MAX_ITERATIONS = 12;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const request: ChatCompletionRequest = {
      ...input.turn.request,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
    };

    const response = await input.client.createChatCompletion(
      input.surface,
      request,
      { sessionId: input.sessionId, sendEnv: iteration === 0, operator: iteration > 0 },
    );

    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason;
    const assistantMessage = choice?.message;

    if (finishReason === "stop" || !assistantMessage?.tool_calls?.length) {
      if (input.onStep) input.onStep("Done.");
      return { response, toolExecutions };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // ignore malformed
      }

      if (input.onStep) {
        let label = toolName.toLowerCase();
        if (toolName === "shell") label = `running ${(args.command as string || "").split(" ")[0]}`;
        else if (toolName === "read_file") label = `reading ${args.path}`;
        else if (toolName === "write_file") label = `writing ${args.path}`;
        else if (toolName === "patch") label = `patching ${args.path}`;
        input.onStep(`${label}...`);
      }

      const result = await executeToolCall(toolName, args, {
        cwd: input.cwd || process.cwd(),
      });

      toolExecutions.push({
        tool: toolName,
        summary: result.summary,
        ok: result.ok,
        patch: result.patch,
        changedFile: result.changedFile,
        draft: result.draft,
        travel: result.travel,
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.body,
      });
    }
  }

  return {
    response: { choices: [{ message: { role: "assistant", content: "I've reached my maximum reasoning steps." }, finish_reason: "length" }] },
    toolExecutions,
  };
}

export function parseApprovalIntent(input: string): "apply" | "cancel" | null {
  const normalized = input.trim().toLowerCase();
  if (["y", "yes", "apply", "/apply"].includes(normalized)) return "apply";
  if (["n", "no", "cancel", "/cancel"].includes(normalized)) return "cancel";
  return null;
}

export async function tryLocalCommand(
  input: string,
  options: {
    client: OriClient;
    profile: string;
    sessionId: string;
    surface: string;
    workspace: WorkspaceSnapshot | null;
    pendingDraft?: any;
    pendingPlanDraft?: any;
  }
): Promise<{
  handled: boolean;
  assistantMessage?: string;
  workspace?: WorkspaceSnapshot;
  scratchpad?: ScratchpadState | null;
  patch?: string;
  changedFile?: string;
  draft?: any;
  planDraft?: any;
  clearDraft?: boolean;
  clearPlanDraft?: boolean;
  verification?: any;
  travel?: { toPath: string; label: string; workspace: WorkspaceSnapshot };
  followUpInput?: string;
}> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  if (trimmed === "/clear") {
     return { handled: true, assistantMessage: "I’ve cleared the session for you." };
  }
  
  if (trimmed === "/apply") {
    if (!options.pendingDraft && !options.pendingPlanDraft) {
      return { handled: true, assistantMessage: "There isn’t a draft to apply right now." };
    }
    return { handled: true, assistantMessage: "Applied.", clearDraft: true, clearPlanDraft: true };
  }

  if (trimmed === "/cancel") {
    if (!options.pendingDraft && !options.pendingPlanDraft) {
      return { handled: true, assistantMessage: "There wasn’t a draft to cancel." };
    }
    return { handled: true, assistantMessage: "Canceled.", clearDraft: true, clearPlanDraft: true };
  }

  return { handled: false };
}
