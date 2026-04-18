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

export function extractAssistantText(
  response: ChatCompletionResponse,
): string {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

export function synthesizeAssistantFallback(
  userInput: string,
  toolExecutions: AgentToolExecution[],
): string {
  if (toolExecutions.length === 0) {
    return "";
  }

  const lower = userInput.trim().toLowerCase();
  const byTool = new Map(toolExecutions.map((execution) => [execution.tool, execution]));
  const gitStatus = byTool.get("git_status")?.body?.trim() ?? "";
  const diffStat = byTool.get("diff_stat")?.body?.trim() ?? "";
  const stagedDiff = byTool.get("git_diff_staged")?.body?.trim() ?? "";
  const gitLog = byTool.get("git_log")?.body?.trim() ?? "";

  if (lower.includes("last commit")) {
    const firstCommit = gitLog.split("\n").map((line) => line.trim()).find(Boolean);
    if (firstCommit) {
      return `Last commit: ${firstCommit}`;
    }
  }

  if (
    lower.includes("last changes") ||
    lower.includes("recent changes") ||
    lower.includes("what changed") ||
    lower.includes("repo sitrep") ||
    lower.includes("sitrep")
  ) {
    const parts: string[] = [];

    if (gitStatus) {
      parts.push(
        gitStatus === "Working tree clean."
          ? "Working tree is clean."
          : `Working tree status:\n${gitStatus}`,
      );
    }

    if (diffStat && diffStat !== "No changes detected.") {
      parts.push(`Unstaged diff:\n${diffStat}`);
    }

    if (stagedDiff && stagedDiff !== "No staged changes detected.") {
      parts.push(`Staged diff:\n${stagedDiff}`);
    }

    const recentCommits = gitLog
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (recentCommits.length > 0) {
      parts.push(`Recent commits:\n${recentCommits.join("\n")}`);
    }

    if (parts.length > 0) {
      return parts.join("\n\n");
    }
  }

  const firstUsefulBody = toolExecutions
    .map((execution) => execution.body.trim())
    .find((body) => body.length > 0);

  return firstUsefulBody ?? "";
}

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
2. Surface selects the product lane, but the current workspace is the active world.
3. Strictly focus on the local filesystem and the current repository context.
4. Do not recite broad VPS infrastructure, global host configurations, or unrelated ORI platform metadata unless explicitly asked to inspect the host environment.
5. Your primary mission is to understand, plan, and execute changes within the current workspace path: ${cwd}.
6. Treat sibling repos, shared VPS state, and other ORI surfaces as out of scope unless the user explicitly asks to cross that boundary.
7. Be extremely concise and direct.
8. DO NOT NARRATE your tool usage or internal reasoning steps in your final response to the user. (e.g. avoid "I have checked the files and found..."). Just state the findings or provide the answer directly.
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
      {
        sessionId: input.sessionId,
        sendEnv: iteration === 0,
        operator: iteration > 0,
        workspace: input.workspace
          ? {
              cwd: input.workspace.cwd,
              repoRoot: input.workspace.repoRoot,
              branch: input.workspace.branch,
            }
          : undefined,
      },
    );

    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason;
    const assistantMessage = choice?.message;

    const toolCalls = assistantMessage?.tool_calls ?? [];

    // Some ORI / provider combinations can return tool calls with finish_reason="stop".
    // Treat tool presence as authoritative so repo-aware turns don't terminate early
    // with an empty assistant shell before local tools execute.
    if (toolCalls.length === 0) {
      if (input.onStep) input.onStep("Done.");
      return { response, toolExecutions };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
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
