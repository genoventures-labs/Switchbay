import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DEFAULTS } from "../config/defaults";
import {
  APP_STORAGE_DIR,
  PROJECT_CONTEXT_FILE,
  existingProjectContextPath,
  existingWorkspaceDataPath,
  workspaceStorageDir,
} from "../config/paths";
import type { ChatRuntimeClient } from "../runtime/client";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OriMessage,
} from "../runtime/types";
import {
  AGENT_TOOLS,
  type AgentToolExecution,
  executeToolCall,
} from "./tools";
import {
  loadAllAgents,
  findAgent,
  agentSystemPrompt,
} from "./agents";
import { buildToolboxPromptBlock } from "../toolbox/hub";
import { buildMemoryPromptBlock } from "../memory/store";
import {
  type AgentMode,
  createThoughtFrame,
  createTranscriptEntry,
  type SessionState,
  type TranscriptEntry,
} from "./turn-state";
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from "../session/workspace";
import { listProjectFiles } from "../tools/files";
import { runCommand } from "../tools/shell";

export async function generatePlan(
  client: ChatRuntimeClient,
  surface: string,
  goal: string,
  cwd: string,
): Promise<string[]> {
  // Embed workspace context so the plan is grounded in the actual project
  let context = "";
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const names = entries
      .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .slice(0, 30)
      .join("  ");
    context = `Workspace: ${cwd}\nTop-level: ${names}`;
  } catch { /* ignore */ }

  const resp = await client.createChatCompletion(surface, {
    model: undefined,
    messages: [
      {
        role: "system",
        content: "You are a precise task planner for a coding agent. Break the goal into 3–7 concrete, sequential steps. Each step must be actionable by a coding agent in a single pass — search, read, write, run a command, or make a specific change. No vague steps like 'refactor everything'. Output ONLY a numbered list, one step per line, no preamble.",
      },
      {
        role: "user",
        content: `Goal: ${goal}\n\n${context}\n\nBreak this into concrete steps:`,
      },
    ],
  });

  const text = extractAssistantText(resp);
  const steps = text
    .split("\n")
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 5);

  if (steps.length === 0) throw new Error("The model returned no steps.");
  return steps;
}

export type PendingAgentDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

export async function generateAgentDefinition(
  client: ChatRuntimeClient,
  surface: string,
  answers: { name: string; specialty: string; approach: string; rules: string },
): Promise<PendingAgentDraft> {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const prompt = `You are writing an agent definition file. Agents inject a focused system prompt into a coding assistant session to give it a specialist mindset.

Create a concise, dense agent definition for:
- Name: ${answers.name}
- Core expertise: ${answers.specialty}
${answers.approach ? `- Communication style / approach: ${answers.approach}` : ""}
${answers.rules ? `- Hard rules (must flag / must never do): ${answers.rules}` : ""}

Write the agent's system prompt injection. It should:
1. Start with "You are operating as a [role]."
2. State priorities clearly (3-5 bullet points or "Priorities: ..." lines)
3. State preferences ("Prefer: ...")
4. State what to always flag or call out ("Always call out: ...")
5. State hard constraints if any ("Avoid: ..." or "Never: ...")

Be dense and direct. No filler. Max 200 words. Output ONLY the system prompt text — no markdown headers, no preamble, no explanation.`;

  const resp = await client.createChatCompletion(surface, {
    model: undefined,
    messages: [
      {
        role: "system",
        content: "You write tight, actionable system prompt injections for AI coding agents. Output only the prompt text.",
      },
      { role: "user", content: prompt },
    ],
  });

  const generatedPrompt = extractAssistantText(resp);
  if (!generatedPrompt) throw new Error("The model returned no content.");

  const savePath = join(workspaceStorageDir(process.cwd()), "agents", `${id}.md`);

  const fileContent = `# ${answers.name}
description: ${answers.specialty.slice(0, 100)}

${generatedPrompt}
`;

  return { id, name: answers.name, content: fileContent, savePath };
}

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
  const extracted =
    extractTextFromUnknown(content) ||
    extractTextFromUnknown((choice as Record<string, unknown> | undefined)?.["text"]) ||
    extractTextFromUnknown(response.output_text);
  const trimmed = extracted.trim();
  return isGenericEmptyFallbackText(trimmed) ? "" : trimmed;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromUnknown(item))
      .filter(Boolean)
      .join("");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.text === "string") {
      return record.text;
    }

    if (record.text && typeof record.text === "object") {
      const nestedText = (record.text as Record<string, unknown>).value;
      if (typeof nestedText === "string") {
        return nestedText;
      }
    }

    if (typeof record.content === "string") {
      return record.content;
    }

    if (Array.isArray(record.content)) {
      return extractTextFromUnknown(record.content);
    }
  }

  return "";
}

export function synthesizeAssistantFallback(
  userInput: string,
  toolExecutions: AgentToolExecution[],
  workspace?: WorkspaceSnapshot | null,
): string {
  if (toolExecutions.length === 0) {
    return "";
  }

  const firstUsefulBody = toolExecutions
    .map((execution) => execution.body.trim())
    .find((body) => body.length > 0);

  return firstUsefulBody ?? "";
}

function isGenericEmptyFallbackText(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower === "i’m here, but that turn came back empty. ask again with a little more detail." ||
    lower === "i'm here, but that turn came back empty. ask again with a little more detail." ||
    lower === "ori returned no assistant text for this turn."
  );
}

export async function refreshWorkspace(): Promise<WorkspaceSnapshot> {
  return loadWorkspaceSnapshot(process.cwd());
}

export async function buildTurn(input: {
  input: string;
  mode: string;
  previousObjective: string | null;
  profile: string;
  transcript: OriMessage[];
  workspace: WorkspaceSnapshot | null;
  activeAgentId?: string | null;
}): Promise<BuiltTurn> {
  const mode = (input.mode as AgentMode) || "build";
  const objective = input.input.slice(0, 100);
  const cwd = input.workspace?.cwd || process.cwd();

  // Inject project context if it exists.
  let oriMdBlock = "";
  const contextPath = existingProjectContextPath(cwd);
  if (contextPath) {
    try {
      const context = readFileSync(contextPath, "utf-8").trim();
      if (context) oriMdBlock = `\n\nPROJECT CONTEXT (${contextPath.endsWith(PROJECT_CONTEXT_FILE) ? PROJECT_CONTEXT_FILE : `legacy ${basename(contextPath)}`} — treat as authoritative):\n${context}`;
    } catch { /* ignore */ }
  }

  const memoryBlock = await buildMemoryPromptBlock(cwd);

  // Inject pinned files
  let pinsBlock = "";
  const pinsJsonPath = existingWorkspaceDataPath(cwd, "pins.json");
  if (existsSync(pinsJsonPath)) {
    try {
      const pins: string[] = JSON.parse(readFileSync(pinsJsonPath, "utf-8"));
      const parts: string[] = [];
      for (const p of pins.slice(0, 10)) {
        try {
          const abs = p.startsWith("/") ? p : join(cwd, p);
          const content = readFileSync(abs, "utf-8");
          const trimmedContent = content.length > 3000 ? content.slice(0, 3000) + "\n… [truncated]" : content;
          parts.push(`### ${p}\n\`\`\`\n${trimmedContent}\n\`\`\``);
        } catch { /* file missing — skip silently */ }
      }
      if (parts.length) pinsBlock = `\n\nPINNED FILES (from ${APP_STORAGE_DIR}/pins.json, always in context):\n${parts.join("\n\n")}`;
    } catch { /* ignore malformed */ }
  }

  // Inject active agent persona if one is set
  let agentBlock = "";
  if (input.activeAgentId) {
    const allAgents = await loadAllAgents();
    const activeAgent = findAgent(input.activeAgentId, allAgents);
    if (activeAgent) agentBlock = agentSystemPrompt(activeAgent);
  }

  const toolboxBlock = await buildToolboxPromptBlock();

  let systemPrompt = `You are a local-first coding agent running inside a terminal switchbay.
Current Mode: ${mode}
Current Profile: ${input.profile}
Current Workspace: ${cwd}${oriMdBlock}${memoryBlock}${pinsBlock}${agentBlock}${toolboxBlock}

GROUNDING RULES:
1. You are running inside a local development tool.
2. Runtime lane and profile may influence style, but the current workspace is the active world.
3. Strictly focus on the local filesystem and the current repository context.
4. Do not recite broad host infrastructure, global host configurations, or unrelated platform metadata unless explicitly asked to inspect the host environment.
5. Your primary mission is to understand, plan, and execute changes within the current workspace path: ${cwd}.
6. Treat sibling repos and shared host state as out of scope unless the user explicitly asks to cross that boundary.
7. Be extremely concise and direct.
8. DO NOT NARRATE your tool usage or internal reasoning steps in your final response to the user. (e.g. avoid "I have checked the files and found..."). Just state the findings or provide the answer directly.
`;
  // Proactively embed live workspace context so the model can answer questions about
  // the project, recent changes, and git state without server-side tool calls.
  const [statusResult, logResult] = await Promise.all([
    runCommand(["git", "status", "--short"], cwd),
    runCommand(["git", "log", "-5", "--oneline"], cwd),
  ]);

  const snapshotLines: string[] = [];

  // Top-level file listing lets the model reason about tech stack and project type.
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const names = entries
      .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .slice(0, 40);
    if (names.length > 0) snapshotLines.push(`Top-level files:\n${names.join("  ")}`);
  } catch { /* ignore */ }

  // package.json summary — name, description, scripts, deps
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const parts: string[] = [];
    if (pkg.name) parts.push(`name: ${pkg.name}`);
    if (pkg.description) parts.push(`description: ${pkg.description}`);
    if (pkg.scripts) parts.push(`scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 20);
    if (deps.length) parts.push(`deps: ${deps.join(", ")}`);
    if (parts.length) snapshotLines.push(`package.json:\n${parts.join("\n")}`);
  } catch { /* not a node project or no package.json */ }

  // Git state
  if (statusResult.ok && statusResult.stdout.trim()) {
    snapshotLines.push(`Working tree:\n${statusResult.stdout.trim()}`);
  } else if (statusResult.ok) {
    snapshotLines.push("Working tree: clean");
  }
  if (logResult.ok && logResult.stdout.trim()) {
    snapshotLines.push(`Recent commits:\n${logResult.stdout.trim()}`);
  }

  if (snapshotLines.length > 0) {
    systemPrompt += `\n\nWORKSPACE SNAPSHOT (pre-fetched — authoritative, do not re-run these commands):\n${snapshotLines.join("\n\n")}`;
  }

  systemPrompt += `\n\nTOOL USE:
You have access to tools that execute on the user's local machine via this app's tool bridge. You do not run them yourself — call them via the API tool_calls mechanism and the client executes them locally.

- Read-only commands (ls, cat, pwd, grep, find, echo, wc, head, tail, curl for GET, etc.): call shell immediately — do NOT set requires_approval.
- Routine local work should run without approval: file edits, mkdir/mv/cp within the workspace, installs, builds, tests, formatting, git add, and git commit when the user asked for a commit.
- Require approval only for broad, destructive, privileged, publishing, or external-impact commands: rm/rmdir, git push, git reset, git clean, sudo, chmod/chown, dd/mkfs/fdisk, publish commands, and curl/wget piped to a shell.
- Chain multiple tool calls in one response when needed.
- NEVER say you lack shell or filesystem access — you have full local access via the tool bridge.`;

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
      model: undefined,
      messages,
    },
    resolvedProfile: input.profile,
  };
}

function parseInlineToolCalls(text: string): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> {
  const calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    const rawCall = match[1];
    if (!rawCall) continue;
    try {
      const parsed = JSON.parse(rawCall) as { name?: string; args?: Record<string, unknown> };
      if (parsed.name) {
        calls.push({
          id: `inline-${Date.now()}-${i++}`,
          type: "function",
          function: { name: parsed.name, arguments: JSON.stringify(parsed.args ?? {}) },
        });
      }
    } catch { /* ignore malformed */ }
  }
  return calls;
}

function stripInlineToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

export async function executeTurn(input: {
  client: ChatRuntimeClient;
  cwd?: string;
  sessionId: string;
  workspace?: WorkspaceSnapshot | null;
  surface: string;
  turn: BuiltTurn;
  onStep?: (title: string) => void;
  onToken?: (token: string) => void;
  onTokens?: (count: number) => void;
}): Promise<ExecutedTurn> {
  const toolExecutions: AgentToolExecution[] = [];
  const messages: OriMessage[] = [...input.turn.request.messages];
  const MAX_ITERATIONS = 12;
  let emptyReplyRetries = 0;
  const MAX_EMPTY_REPLY_RETRIES = 1;

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
        // Stream text tokens live on every iteration. When the model calls tools
        // it emits tool_call deltas (not text), so onToken never fires mid-loop.
        // It only fires on the final text-only response — exactly when we want it.
        onToken: input.onToken,
      },
    );

    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;
    const assistantText = extractAssistantText(response);

    const nativeToolCalls = assistantMessage?.tool_calls ?? [];
    const inlineToolCalls = nativeToolCalls.length === 0 ? parseInlineToolCalls(assistantText) : [];
    const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : inlineToolCalls;
    const cleanedText = inlineToolCalls.length > 0 ? stripInlineToolCalls(assistantText) : assistantText;

    if (toolCalls.length === 0 && cleanedText === "" && emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES) {
      emptyReplyRetries += 1;
      if (input.onStep) input.onStep("retrying empty reply...");
      messages.push({
        role: "user",
        content:
          "Your previous reply was empty. Answer the user's last request directly in plain text now. Do not return an empty message.",
      });
      continue;
    }

    if (toolCalls.length === 0) {
      if (input.onStep) input.onStep("Done.");
      return { response, toolExecutions };
    }

    messages.push({
      role: "assistant",
      content: inlineToolCalls.length > 0 ? cleanedText : (assistantMessage?.content ?? ""),
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
        if (toolName === "shell") label = `shell: ${(args.command as string || "").slice(0, 40)}`;
        else if (toolName === "git_commit") label = `git commit: ${String(args.message || "").slice(0, 40)}`;
        else if (toolName === "git_add") label = `git add ${args.paths}`;
        else if (toolName === "git_push") label = `git push ${args.remote || "origin"}`;
        else if (toolName === "read_file") label = `reading ${args.path}`;
        else if (toolName === "write_file") label = `writing ${args.path}`;
        else if (toolName === "apply_patch") label = `patching ${args.path}`;
        else if (toolName === "create_file") label = `creating ${args.path}`;
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
        body: result.body,
        patch: result.patch,
        changedFile: result.changedFile,
        travel: result.travel,
        shellPending: result.shellPending,
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.body,
      });

      if (input.onTokens) {
        input.onTokens(Math.max(1, Math.round(result.body.length / 4)));
      }
    }
  }

  return {
    response: { choices: [{ message: { role: "assistant", content: "I've reached my maximum reasoning steps." }, finish_reason: "length" }] },
    toolExecutions,
  };
}
