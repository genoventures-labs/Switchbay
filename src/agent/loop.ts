import { DEFAULTS } from "../config/defaults";
import type { OriClient } from "../runtime/ori-client";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OriMessage,
  ScratchpadState,
} from "../runtime/types";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../tools/files";
import { getGitStatusSummary, getRecentGitLog } from "../tools/git";
import { getDiffSummary } from "../tools/patch";
import { buildPatchPreview, type PatchPreview } from "../tools/patch";
import { runVerification, type VerificationSummary } from "../tools/verify";
import { deriveObjective, draftPlan } from "./planner";
import { resolveAgentPolicy } from "./policy";
import type { WorkspaceSnapshot } from "../session/workspace";
import { formatWorkspaceContext, loadWorkspaceSnapshot } from "../session/workspace";
import type { DraftEdit } from "./turn-state";
import {
  AGENT_TOOLS,
  executeToolCall,
  type AgentToolExecution,
} from "./tools";
import { fuzzyMatchLocations, listTravelLocations, travelTo } from "../tools/travel";

export type TurnBuildInput = {
  input: string;
  mode?: string;
  profile: string;
  previousObjective: string | null;
  transcript: OriMessage[];
  workspace: WorkspaceSnapshot | null;
};

export type BuiltTurn = {
  objective: string;
  pendingPlan: string[];
  request: ChatCompletionRequest;
  resolvedProfile: string;
  mode: ReturnType<typeof resolveAgentPolicy>["mode"];
};

export type ExecutedTurn = {
  response: ChatCompletionResponse;
  toolExecutions: AgentToolExecution[];
};

export type LocalCommandResult = {
  handled: boolean;
  draft?: DraftEdit;
  assistantMessage?: string;
  changedFile?: string;
  patch?: PatchPreview;
  workspace?: WorkspaceSnapshot;
  verification?: VerificationSummary;
  clearDraft?: boolean;
  scratchpad?: ScratchpadState | null;
  /** Set when the command performed a workspace travel */
  travel?: {
    toPath: string;
    label: string;
    workspace: WorkspaceSnapshot | null;
  };
};

type ParsedLocalCommand =
  | { type: "clear" }
  | { type: "workspace" }
  | { type: "files" }
  | { type: "diff" }
  | { type: "verify" }
  | { type: "health" }
  | { type: "models" }
  | { type: "tools" }
  | { type: "browserHealth" }
  | { type: "daemons" }
  | { type: "spaces" }
  | { type: "sessions" }
  | { type: "sessionMessages"; sessionId: string }
  | { type: "apply" }
  | { type: "cancel" }
  | { type: "gitStatus" }
  | { type: "gitLog" }
  | { type: "oriCapability"; capability: "ask_ori" | "memory_lookup" | "plan_review" | "repo_research" | "web_search" | "web_fetch" | "research" | "repo_report"; prompt: string }
  | { type: "edit"; targetPath: string; instruction: string }
  | { type: "read"; targetPath: string }
  | { type: "write"; targetPath: string; content: string }
  | { type: "append"; targetPath: string; content: string }
  | { type: "replace"; targetPath: string; find: string; replace: string }
  | { type: "hop"; query: string }
  | { type: "locations" }
  | { type: "unknown" };

type OriCapabilityCommand =
  | "ask_ori"
  | "memory_lookup"
  | "plan_review"
  | "repo_research"
  | "web_search"
  | "web_fetch"
  | "research"
  | "repo_report";

function parseLocalCommand(input: string): ParsedLocalCommand {
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized === "/clear") return { type: "clear" };
  if (normalized === "/workspace") return { type: "workspace" };
  if (normalized === "/files") return { type: "files" };
  if (normalized === "/diff") return { type: "diff" };
  if (normalized === "/verify") return { type: "verify" };
  if (normalized === "/health") return { type: "health" };
  if (normalized === "/models") return { type: "models" };
  if (normalized === "/tools") return { type: "tools" };
  if (normalized === "/browser-health") return { type: "browserHealth" };
  if (normalized === "/daemons") return { type: "daemons" };
  if (normalized === "/spaces") return { type: "spaces" };
  if (normalized === "/sessions") return { type: "sessions" };
  if (normalized === "/apply") return { type: "apply" };
  if (normalized === "/cancel") return { type: "cancel" };
  if (normalized === "/git-status") return { type: "gitStatus" };
  if (normalized === "/git-log") return { type: "gitLog" };
  if (normalized === "/locations") return { type: "locations" };

  if (normalized.startsWith("/hop")) {
    const query = trimmed.slice(4).trim();
    return { type: "hop", query };
  }

  if (normalized.startsWith("/session ")) {
    const sessionId = trimmed.slice(9).trim();
    if (sessionId) {
      return { type: "sessionMessages", sessionId };
    }
  }

  const capabilityCommands: Array<{
    capability: OriCapabilityCommand;
    prefix: string;
  }> = [
    { capability: "ask_ori", prefix: "/ask " },
    { capability: "memory_lookup", prefix: "/memory " },
    { capability: "plan_review", prefix: "/plan-review " },
    { capability: "repo_research", prefix: "/repo-research " },
    { capability: "web_search", prefix: "/search " },
    { capability: "web_fetch", prefix: "/fetch " },
    { capability: "research", prefix: "/research " },
    { capability: "repo_report", prefix: "/repo-report " },
  ];

  for (const command of capabilityCommands) {
    if (normalized.startsWith(command.prefix)) {
      const prompt = trimmed.slice(command.prefix.length).trim();
      if (prompt) {
        return {
          type: "oriCapability",
          capability: command.capability,
          prompt,
        };
      }
    }
  }

  if (normalized.startsWith("/edit ")) {
    const [targetPath, instruction] = trimmed.slice(6).split(" ::: ", 2);
    if (targetPath && instruction !== undefined) {
      return {
        type: "edit",
        targetPath: targetPath.trim(),
        instruction,
      };
    }
  }

  if (normalized.startsWith("/read ")) {
    return { type: "read", targetPath: trimmed.slice(6).trim() };
  }

  if (normalized.startsWith("/write ")) {
    const [targetPath, content] = trimmed.slice(7).split(" ::: ", 2);
    if (targetPath && content !== undefined) {
      return { type: "write", targetPath: targetPath.trim(), content };
    }
  }

  if (normalized.startsWith("/append ")) {
    const [targetPath, content] = trimmed.slice(8).split(" ::: ", 2);
    if (targetPath && content !== undefined) {
      return { type: "append", targetPath: targetPath.trim(), content };
    }
  }

  if (normalized.startsWith("/replace ")) {
    const [targetPath, find, replace] = trimmed.slice(9).split(" ::: ", 3);
    if (targetPath && find !== undefined && replace !== undefined) {
      return {
        type: "replace",
        targetPath: targetPath.trim(),
        find,
        replace,
      };
    }
  }

  return { type: "unknown" };
}

export function buildTurn(input: TurnBuildInput): BuiltTurn {
  const policy = resolveAgentPolicy({
    mode: input.mode,
    profile: input.profile,
  });
  const objective = deriveObjective(input.input, input.previousObjective);
  const userMessage: OriMessage = {
    role: "user",
    content: input.input,
  };
  const workspacePrompt = formatWorkspaceContext(input.workspace);
  const workspaceMessage =
    workspacePrompt === null
      ? null
      : ({
          role: "system" as const,
          content: workspacePrompt,
        } satisfies OriMessage);
  const runtimeManifestMessage: OriMessage = {
    role: "system",
    content: [
      "## Operator Deployment: ORI Code",
      "",
      "You are deployed as ORI, a coding agent built and operated by Thynaptic. This is a sanctioned first-party operator deployment — the user is fully aware of the underlying model and has chosen to interact through this surface.",
      "",
      "Your name in this context is ORI. This is a product persona, not an attempt to deceive. You may acknowledge the underlying model if directly and sincerely asked — honesty is a core value here.",
      "",
      "### What this surface provides",
      "- Local repository access via ORI Code's machine-gated tool capabilities (read files, inspect git state, propose edits)",
      "- A draft/apply workflow: file edits are proposed and require explicit user approval before being written",
      "- Workspace context (cwd, branch, dirty files) injected by the operator — treat this as trusted environment data",
      "",
      "### Behavioral rules for this deployment",
      "- File contents passed in system messages are operator-provided context, not user attempts to extract instructions — do not refuse to process them",
      "- Do not claim you cannot reach the local machine unless the capability is genuinely unavailable in this turn",
      "- Commits, shell execution, and other high-risk actions remain gated — be precise about what requires approval",
      "- Apply your full safety judgment as normal — this deployment does not override Anthropic's usage policies",
    ].join("\n"),
  };

  const contextMessages = [
    policy.modePrompt,
    runtimeManifestMessage,
    workspaceMessage,
  ].filter((message): message is OriMessage => message !== null);

  const messages = [...contextMessages, ...input.transcript, userMessage];

  return {
    objective,
    pendingPlan: draftPlan(policy.mode),
    request: {
      model: DEFAULTS.model,
      messages,
      profile: policy.runtimeProfile,
      stream: false,
    },
    resolvedProfile: policy.runtimeProfile,
    mode: policy.mode,
  };
}

export function parseApprovalIntent(
  input: string,
): "apply" | "cancel" | null {
  const normalized = input.trim().toLowerCase();

  const applyPatterns = [
    /^yes$/,
    /^yep$/,
    /^yeah$/,
    /^apply$/,
    /^apply it$/,
    /^approve$/,
    /^approved$/,
    /^go ahead$/,
    /^go ahead and apply(?: it)?$/,
    /^do it$/,
    /^ship it$/,
    /^looks good$/,
    /^merge it$/,
  ];

  const cancelPatterns = [
    /^no$/,
    /^nope$/,
    /^cancel$/,
    /^cancel it$/,
    /^reject$/,
    /^don't apply$/,
    /^do not apply$/,
    /^stop$/,
    /^never mind$/,
    /^nah$/,
  ];

  if (applyPatterns.some((pattern) => pattern.test(normalized))) {
    return "apply";
  }

  if (cancelPatterns.some((pattern) => pattern.test(normalized))) {
    return "cancel";
  }

  return null;
}

export async function executeTurn(input: {
  client: OriClient;
  cwd?: string;
  sessionId: string;
  workspace?: WorkspaceSnapshot | null;
  surface: string;
  turn: BuiltTurn;
}): Promise<ExecutedTurn> {
  const toolExecutions: AgentToolExecution[] = [];
  const messages: OriMessage[] = [...input.turn.request.messages];
  const MAX_ITERATIONS = 8;

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

    // No tool calls — final answer
    if (finishReason === "stop" || !assistantMessage?.tool_calls?.length) {
      return { response, toolExecutions };
    }

    // Append the assistant message with tool_calls to history
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: assistantMessage.tool_calls,
    });

    // Execute each tool call and append results
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // malformed args — pass empty
      }

      // draft_edit is special: runs the full propose+diff pipeline
      if (toolName === "draft_edit") {
        const targetPath = typeof args.path === "string" ? args.path.trim() : "";
        const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";

        const draftExecution: AgentToolExecution =
          !targetPath || !instruction
            ? { ok: false, summary: "draft_edit: missing required args 'path' and 'instruction'", tool: toolName }
            : await proposeDraftToolExecution({
                client: input.client,
                cwd: input.cwd,
                instruction,
                profile: input.turn.resolvedProfile,
                sessionId: input.sessionId,
                surface: input.surface,
                targetPath,
                workspace: input.workspace ?? null,
              });

        toolExecutions.push(draftExecution);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: draftExecution.summary,
        });
        continue;
      }

      const execution = await executeToolCall(toolName, args, {
        client: input.client,
        profile: input.turn.resolvedProfile,
        cwd: input.cwd,
        recentFiles: input.workspace?.recentFiles,
        sessionId: input.sessionId,
        surface: input.surface,
      });
      toolExecutions.push(execution);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: execution.summary,
      });
    }
  }

  return {
    response: {
      choices: [
        {
          message: { role: "assistant", content: "Reached tool iteration limit for this turn." },
          finish_reason: "stop",
        },
      ],
    },
    toolExecutions,
  };
}

async function proposeFileEdit(input: {
  client: OriClient;
  instruction: string;
  profile: string;
  sessionId?: string;
  surface: string;
  targetPath: string;
  workspace: WorkspaceSnapshot | null;
  cwd?: string;
}): Promise<{ draft: DraftEdit; scratchpad: ScratchpadState | null }> {
  const cwd = input.cwd ?? process.cwd();
  const file = await readWorkspaceFile(input.targetPath, cwd);
  const workspacePrompt = formatWorkspaceContext(input.workspace);

  const response = await input.client.createChatCompletion(
    input.surface,
    {
      model: DEFAULTS.model,
      profile: input.profile,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are editing a source file for ORI Code, a first-party coding agent. Return only the full updated file contents with no markdown fences, no explanation, and no surrounding commentary.",
        },
        ...(workspacePrompt
          ? [
              {
                role: "system" as const,
                content: workspacePrompt,
              },
            ]
          : []),
        {
          role: "system",
          content: [
            `Target file: ${input.targetPath}`,
            "Current file contents:",
            file.content,
          ].join("\n\n"),
        },
        {
          role: "user",
          content: input.instruction,
        },
      ],
    },
    { sessionId: input.sessionId, operator: true },
  );

  const after = response.choices?.[0]?.message?.content?.replace(/\s+$/, "") ?? "";
  const before = file.content;
  const patch = await buildPatchPreview({
    before,
    after,
    cwd,
    targetPath: input.targetPath,
  });

  return {
    draft: {
      before,
      after,
      patch,
      reason: `ORI proposed an edit for: ${input.instruction}`,
      targetPath: input.targetPath,
    },
    scratchpad: response.meta?.scratchpad ?? null,
  };
}

async function proposeDraftToolExecution(input: {
  client: OriClient;
  cwd?: string;
  instruction: string;
  profile: string;
  sessionId?: string;
  surface: string;
  targetPath: string;
  workspace: WorkspaceSnapshot | null;
}): Promise<AgentToolExecution> {
  const editResult = await proposeFileEdit(input);

  return {
    draft: editResult.draft,
    ok: true,
    summary: [
      `Drafted edit for ${input.targetPath}.`,
      `Reason: ${editResult.draft.reason}`,
      "",
      editResult.draft.patch.diff,
      "",
      "Ask the user for approval before applying it.",
    ].join("\n"),
    tool: "local:draft_edit",
  };
}

export async function refreshWorkspace(cwd = process.cwd()) {
  return loadWorkspaceSnapshot(cwd);
}

export async function tryLocalCommand(
  input: string,
  options: {
    client?: OriClient;
    profile?: string;
    sessionId?: string;
    surface?: string;
    cwd?: string;
    pendingDraft?: DraftEdit | null;
    workspace?: WorkspaceSnapshot | null;
  } = {},
): Promise<LocalCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const command = parseLocalCommand(input);

  if (command.type === "workspace") {
    const workspace = await loadWorkspaceSnapshot(cwd);
    return {
      handled: true,
      workspace,
      assistantMessage: [
        `Workspace: ${workspace.cwd}`,
        `Branch: ${workspace.branch ?? "unknown"}`,
        `Dirty files: ${workspace.dirtyFiles.length || 0}`,
      ].join("\n"),
    };
  }

  if (command.type === "clear") {
    return {
      handled: true,
      assistantMessage: "Clearing the current session view.",
    };
  }

  if (command.type === "files") {
    const workspace = await loadWorkspaceSnapshot(cwd);
    return {
      handled: true,
      workspace,
      assistantMessage:
        workspace.recentFiles.length > 0
          ? `Recent files:\n${workspace.recentFiles.join("\n")}`
          : "I couldn't find project files yet.",
    };
  }

  if (command.type === "diff") {
    const diff = await getDiffSummary(cwd);
    return {
      handled: true,
      assistantMessage: diff.stat,
    };
  }

  if (command.type === "verify") {
    const verification = await runVerification(cwd);
    return {
      handled: true,
      verification,
      assistantMessage: [
        verification.summary,
        verification.stdout || verification.stderr || "No test output.",
      ].join("\n\n"),
    };
  }

  if (command.type === "health") {
    if (!options.client) {
      return {
        handled: true,
        assistantMessage: "Runtime health is unavailable because the ORI client context is missing.",
      };
    }

    const health = await options.client.getHealth();
    return {
      handled: true,
      assistantMessage: `Runtime health:\nstatus: ${health.status ?? "unknown"}\nsystem: ${health.system ?? "unknown"}`,
    };
  }

  if (command.type === "models") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Model listing is unavailable because the ORI client context is missing.",
      };
    }

    const models = await options.client.listModels(options.surface);
    return {
      handled: true,
      assistantMessage:
        models.length > 0
          ? ["Available models:", ...models.map((model) => `- ${model.id ?? "unknown"}`)].join("\n")
          : "No models were returned.",
    };
  }

  if (command.type === "tools") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Tool listing is unavailable because the ORI client context is missing.",
      };
    }

    const tools = await options.client.listTools(options.surface);
    return {
      handled: true,
      assistantMessage:
        tools.length > 0
          ? [
              "Available ORI tools:",
              ...tools.map((tool) => `- ${tool.name ?? "unknown"}${tool.description ? `: ${tool.description}` : ""}`),
            ].join("\n")
          : "No tools were returned.",
    };
  }

  if (command.type === "browserHealth") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Browser health is unavailable because the ORI client context is missing.",
      };
    }

    const browser = await options.client.getBrowserHealth(options.surface);
    return {
      handled: true,
      assistantMessage: `Browser health:\n${JSON.stringify(browser, null, 2)}`,
    };
  }

  if (command.type === "daemons") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Daemon health is unavailable because the ORI client context is missing.",
      };
    }

    const daemons = await options.client.getDaemons(options.surface);
    return {
      handled: true,
      assistantMessage: `Daemon health:\n${JSON.stringify(daemons, null, 2)}`,
    };
  }

  if (command.type === "spaces") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Spaces are unavailable because the ORI client context is missing.",
      };
    }

    const spaces = await options.client.listSpaces(options.surface);
    return {
      handled: true,
      assistantMessage:
        spaces.length > 0
          ? [
              "Available spaces:",
              ...spaces.map((space) => `- ${space.name ?? space.id ?? "unknown"}${space.description ? `: ${space.description}` : ""}`),
            ].join("\n")
          : "No spaces were returned, or this key does not have `runtime:spaces`.",
    };
  }

  if (command.type === "sessions") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Session history is unavailable because the ORI client context is missing.",
      };
    }

    const sessions = await options.client.listSessions({
      limit: 8,
      surface: options.surface,
    });

    return {
      handled: true,
      assistantMessage:
        sessions.length > 0
          ? [
              "Recent ORI sessions:",
              ...sessions.map((session) =>
                `- ${session.id}${session.title ? ` | ${session.title}` : ""}${session.updated ? ` | updated ${session.updated}` : ""}`,
              ),
            ].join("\n")
          : "No recent ORI sessions were returned.",
    };
  }

  if (command.type === "sessionMessages") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "Session messages are unavailable because the ORI client context is missing.",
      };
    }

    const messages = await options.client.getSessionMessages({
      id: command.sessionId,
      limit: 12,
      surface: options.surface,
    });

    return {
      handled: true,
      assistantMessage:
        messages.length > 0
          ? [
              `Messages for ${command.sessionId}:`,
              ...messages.map((message) =>
                `[${message.role ?? "unknown"}] ${message.content ?? ""}`.trim(),
              ),
            ].join("\n\n")
          : `No messages were returned for ${command.sessionId}.`,
    };
  }

  if (command.type === "gitStatus") {
    return {
      handled: true,
      assistantMessage: await getGitStatusSummary(cwd),
    };
  }

  if (command.type === "gitLog") {
    return {
      handled: true,
      assistantMessage: await getRecentGitLog(cwd),
    };
  }

  if (command.type === "read") {
    const file = await readWorkspaceFile(command.targetPath, cwd);
    return {
      handled: true,
      assistantMessage: `Reading ${command.targetPath}\n\n${file.content}`,
    };
  }

  if (command.type === "edit") {
    if (!options.client || !options.surface || !options.profile) {
      return {
        handled: true,
        assistantMessage: "Edit workflow is unavailable because the ORI client context is missing.",
      };
    }

    const editResult = await proposeFileEdit({
      client: options.client,
      instruction: command.instruction,
      profile: options.profile,
      sessionId: options.sessionId,
      surface: options.surface,
      targetPath: command.targetPath,
      workspace: options.workspace ?? null,
      cwd,
    });

    return {
      handled: true,
      draft: editResult.draft,
      scratchpad: editResult.scratchpad,
      assistantMessage: `Drafted ORI edit for ${command.targetPath}\n\n${editResult.draft.patch.diff}`,
    };
  }

  if (command.type === "oriCapability") {
    if (!options.client || !options.surface) {
      return {
        handled: true,
        assistantMessage: "That ORI capability is unavailable because the ORI client context is missing.",
      };
    }

    const result = await options.client.invokeCapability({
      capability: command.capability,
      profile: options.profile,
      prompt: command.prompt,
      sessionId: options.sessionId,
      surface: options.surface,
    });

    return {
      handled: true,
      assistantMessage: result || `No output returned from ori:${command.capability}.`,
    };
  }

  if (command.type === "write") {
    const before = await readWorkspaceFile(command.targetPath, cwd)
      .then((file) => file.content)
      .catch(() => "");
    const patch = await buildPatchPreview({
      before,
      after: command.content,
      cwd,
      targetPath: command.targetPath,
    });

    return {
      handled: true,
      draft: {
        before,
        after: command.content,
        patch,
        reason: "Drafted a full file write.",
        targetPath: command.targetPath,
      },
      assistantMessage: `Drafted write for ${command.targetPath}\n\n${patch.diff}`,
    };
  }

  if (command.type === "append") {
    const existing = await readWorkspaceFile(command.targetPath, cwd).catch(() => ({
      absolutePath: command.targetPath,
      content: "",
    }));
    const nextContent = `${existing.content}${command.content}`;
    const patch = await buildPatchPreview({
      before: existing.content,
      after: nextContent,
      cwd,
      targetPath: command.targetPath,
    });

    return {
      handled: true,
      draft: {
        before: existing.content,
        after: nextContent,
        patch,
        reason: "Drafted an append edit.",
        targetPath: command.targetPath,
      },
      assistantMessage: `Drafted append for ${command.targetPath}\n\n${patch.diff}`,
    };
  }

  if (command.type === "replace") {
    const existing = await readWorkspaceFile(command.targetPath, cwd);
    const nextContent = existing.content.replace(command.find, command.replace);
    const patch = await buildPatchPreview({
      before: existing.content,
      after: nextContent,
      cwd,
      targetPath: command.targetPath,
    });

    return {
      handled: true,
      draft: {
        before: existing.content,
        after: nextContent,
        patch,
        reason: "Drafted a replace edit.",
        targetPath: command.targetPath,
      },
      assistantMessage: `Drafted replace for ${command.targetPath}\n\n${patch.diff}`,
    };
  }

  if (command.type === "apply") {
    if (!options.pendingDraft) {
      return {
        handled: true,
        assistantMessage: "There is no pending draft to apply.",
      };
    }

    await writeWorkspaceFile(
      options.pendingDraft.targetPath,
      options.pendingDraft.after,
      cwd,
    );

    return {
      handled: true,
      clearDraft: true,
      changedFile: options.pendingDraft.targetPath,
      patch: options.pendingDraft.patch,
      assistantMessage: `Applied draft patch for ${options.pendingDraft.targetPath}.`,
    };
  }

  if (command.type === "cancel") {
    return {
      handled: true,
      clearDraft: true,
      assistantMessage: options.pendingDraft
        ? `Canceled draft for ${options.pendingDraft.targetPath}.`
        : "There was no draft to cancel.",
    };
  }

  if (command.type === "locations") {
    const locations = await listTravelLocations();
    if (locations.length === 0) {
      return {
        handled: true,
        assistantMessage:
          "No travel locations found. Add paths to ~/.ori/config.json or enable auto_discover.",
      };
    }
    const lines = locations.map(
      (l) => `${l.isGit ? "⎇" : "📁"} ${l.label}  [${l.source}]`,
    );
    return {
      handled: true,
      assistantMessage: `Available locations:\n\n${lines.join("\n")}`,
    };
  }

  if (command.type === "hop") {
    if (!command.query) {
      const locations = await listTravelLocations();
      const lines = locations.slice(0, 10).map(
        (l) => `${l.isGit ? "⎇" : "📁"} ${l.label}`,
      );
      return {
        handled: true,
        assistantMessage: `Where to? Available locations:\n\n${lines.join("\n")}\n\nUsage: /hop <name>`,
      };
    }

    const matches = await fuzzyMatchLocations(command.query);
    if (matches.length === 0) {
      return {
        handled: true,
        assistantMessage: `No location matched "${command.query}". Use /locations to see available destinations.`,
      };
    }

    const best = matches[0]!;
    const result = await travelTo(best.absPath);

    if (!result.ok) {
      return {
        handled: true,
        assistantMessage: `Hop failed: ${result.error}`,
      };
    }

    return {
      handled: true,
      workspace: result.workspace ?? undefined,
      travel: {
        toPath: result.location!.absPath,
        label: result.location!.label,
        workspace: result.workspace ?? null,
      },
      assistantMessage: `Hopped to ${result.location!.label}`,
    };
  }

  if (command.type === "unknown" && input.trim().startsWith("/")) {
    return {
      handled: true,
      assistantMessage:
        "Unknown slash command. Try /clear, /workspace, /files, /diff, /verify, /git-status, /git-log, /hop <name>, /locations, /read <file>, /edit <file> ::: <instruction>, /write <file> ::: <content>, /append <file> ::: <content>, /replace <file> ::: <find> ::: <replace>, /apply, or /cancel.",
    };
  }

  return { handled: false };
}
