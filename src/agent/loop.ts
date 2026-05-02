import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  loadAllAgents,
  findAgent,
  agentSystemPrompt,
} from "./agents";
import {
  type AgentMode,
  createThoughtFrame,
  createTranscriptEntry,
  type SessionState,
  type TranscriptEntry,
} from "./turn-state";
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from "../session/workspace";
import type { Bundle } from "../tools/bundles";
import { listProjectFiles } from "../tools/files";
import { runCommand } from "../tools/shell";

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
  activeBundles?: Bundle[];
  activeAgentId?: string | null;
}): Promise<BuiltTurn> {
  const mode = (input.mode as AgentMode) || "build";
  const objective = input.input.slice(0, 100);
  const cwd = input.workspace?.cwd || process.cwd();

  // Inject ORI.md as authoritative project context if it exists
  let oriMdBlock = "";
  const oriMdPath = join(cwd, "ORI.md");
  if (existsSync(oriMdPath)) {
    try {
      const oriMd = readFileSync(oriMdPath, "utf-8").trim();
      if (oriMd) {
        oriMdBlock = `\n\nPROJECT CONTEXT (ORI.md — treat as authoritative):\n${oriMd}`;
      }
    } catch { /* ignore */ }
  }

  // Inject active agent persona if one is set
  let agentBlock = "";
  if (input.activeAgentId) {
    const allAgents = await loadAllAgents();
    const activeAgent = findAgent(input.activeAgentId, allAgents);
    if (activeAgent) agentBlock = agentSystemPrompt(activeAgent);
  }

  let systemPrompt = `You are ORI, a sovereign coding agent powered by Thynaptic.
Current Mode: ${mode}
Current Profile: ${input.profile}
Current Workspace: ${cwd}${oriMdBlock}${agentBlock}

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

  // Proactively embed live workspace context so ORI can answer questions about
  // the project, recent changes, and git state without server-side tool calls.
  const [statusResult, logResult] = await Promise.all([
    runCommand(["git", "status", "--short"], cwd),
    runCommand(["git", "log", "-5", "--oneline"], cwd),
  ]);

  const snapshotLines: string[] = [];

  // Top-level file listing — lets ORI reason about tech stack / project type
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
You have access to tools that execute on the user's local machine via the ORI tool bridge. You do not run them yourself — call them via the API tool_calls mechanism and the ori-code client executes them locally.

- Read-only commands (ls, cat, pwd, grep, find, echo, wc, head, tail, curl for GET, etc.): call shell immediately — do NOT set requires_approval.
- Write or destructive commands (npm install, bun add, git commit, git push, rm, mv, file writes): set requires_approval=true — the user confirms before it runs.
- git_add, git_commit, git_push always require approval.
- create_file and apply_patch run immediately (they are file edits, not shell mutations).
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
      model: getDefaultModel(),
      messages,
    },
    resolvedProfile: input.profile,
  };
}

function parseInlineToolCalls(text: string): Array<{ id: string; function: { name: string; arguments: string } }> {
  const calls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name?: string; args?: Record<string, unknown> };
      if (parsed.name) {
        calls.push({
          id: `inline-${Date.now()}-${i++}`,
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
  client: OriClient;
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
    conversation?: import("../runtime/types").OriMessage[];
    lastChangedFile?: string | null;
    activeAgentId?: string | null;
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
  clearTranscript?: boolean;
  compactedConversation?: import("../runtime/types").OriMessage[];
  activateAgent?: string | null;
  openAgentPicker?: boolean;
  verification?: any;
  travel?: { toPath: string; label: string; workspace: WorkspaceSnapshot };
  followUpInput?: string;
}> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) return { handled: false };

  if (trimmed === "/clear") {
    return { handled: true, clearTranscript: true };
  }

  if (trimmed === "/undo") {
    const file = options.lastChangedFile;
    if (!file) {
      return { handled: true, assistantMessage: "Nothing to undo — no file has been changed this session." };
    }
    const cwd = options.workspace?.cwd ?? process.cwd();
    try {
      const { execAsync: exec } = await import("node:child_process").then(m => ({ execAsync: (cmd: string) => new Promise<string>((res, rej) => m.exec(cmd, { cwd }, (err, out) => err ? rej(err) : res(out))) }));
      await exec(`git checkout HEAD -- ${JSON.stringify(file)}`);
      return { handled: true, assistantMessage: `Undid changes to \`${file}\` — restored to HEAD.` };
    } catch (e: any) {
      return { handled: true, assistantMessage: `Undo failed: ${e.message}` };
    }
  }

  if (trimmed === "/init" || trimmed === "/init --update") {
    const cwd = options.workspace?.cwd ?? process.cwd();
    const oriMdPath = join(cwd, "ORI.md");
    const isUpdate = trimmed === "/init --update";

    if (existsSync(oriMdPath) && !isUpdate) {
      return {
        handled: true,
        assistantMessage: `ORI.md already exists in this workspace. Use \`/init --update\` to regenerate it.`,
      };
    }

    // Gather project signals for the prompt
    const signals: string[] = [];

    // Directory structure (top-level, non-hidden, no node_modules)
    try {
      const entries = readdirSync(cwd, { withFileTypes: true });
      const names = entries
        .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist" && e.name !== ".git")
        .map(e => e.isDirectory() ? `${e.name}/` : e.name)
        .slice(0, 50);
      signals.push(`Top-level structure:\n${names.join("  ")}`);
    } catch { /* ignore */ }

    // package.json
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
      const parts: string[] = [];
      if (pkg.name) parts.push(`name: ${pkg.name}`);
      if (pkg.description) parts.push(`description: ${pkg.description}`);
      if (pkg.scripts) parts.push(`scripts: ${JSON.stringify(pkg.scripts)}`);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (deps.length) parts.push(`dependencies: ${deps.join(", ")}`);
      signals.push(`package.json:\n${parts.join("\n")}`);
    } catch { /* not a node project */ }

    // go.mod
    try {
      const goMod = readFileSync(join(cwd, "go.mod"), "utf-8").split("\n").slice(0, 10).join("\n");
      signals.push(`go.mod:\n${goMod}`);
    } catch { /* not a go project */ }

    // Cargo.toml
    try {
      const cargo = readFileSync(join(cwd, "Cargo.toml"), "utf-8").split("\n").slice(0, 20).join("\n");
      signals.push(`Cargo.toml:\n${cargo}`);
    } catch { /* not a rust project */ }

    // README (first 60 lines)
    for (const readmeName of ["README.md", "README.txt", "README"]) {
      try {
        const readme = readFileSync(join(cwd, readmeName), "utf-8").split("\n").slice(0, 60).join("\n");
        signals.push(`README:\n${readme}`);
        break;
      } catch { /* no readme */ }
    }

    // Existing ORI.md if updating
    if (isUpdate && existsSync(oriMdPath)) {
      try {
        const existing = readFileSync(oriMdPath, "utf-8");
        signals.push(`Existing ORI.md (preserve any hand-edited sections):\n${existing}`);
      } catch { /* ignore */ }
    }

    // git log
    try {
      const { runCommand: rc } = await import("../tools/shell");
      const log = await rc(["git", "log", "--oneline", "-10"], cwd);
      if (log.stdout) signals.push(`Recent commits:\n${log.stdout}`);
    } catch { /* ignore */ }

    const prompt = `You are generating an ORI.md file for a software project. This file is injected at the top of every ORI Code session for this workspace — it's the agent's persistent project brain.

Analyze the project signals below and write a concise, dense ORI.md. It should cover:
1. **What this project is** — one tight paragraph, no fluff
2. **Stack** — languages, frameworks, key deps (be specific, include versions if visible)
3. **Key commands** — build, test, run, lint (exact commands)
4. **Project layout** — 5-10 bullet points on the most important dirs/files and what they do
5. **Gotchas & conventions** — things that would trip up a new engineer: naming conventions, env vars, non-obvious config, known footguns
6. **Do not** — anything the agent should never do in this repo (e.g. don't push to main, don't touch X)

Format: use markdown headers (##). Be terse. No filler sentences. Max 400 words.

Project signals:
${signals.join("\n\n")}

Write only the ORI.md content, starting with # ORI.md`;

    try {
      const resp = await options.client.createChatCompletion(options.surface, {
        model: undefined,
        messages: [
          { role: "system", content: "You are a technical documentation writer. Output only the requested file content, no preamble or explanation." },
          { role: "user", content: prompt },
        ],
      });
      const content = resp.choices?.[0]?.message?.content ?? "";
      if (!content) {
        return { handled: true, assistantMessage: "Init failed — ORI returned no content." };
      }
      await writeFile(oriMdPath, content, "utf-8");
      return {
        handled: true,
        assistantMessage: `ORI.md ${isUpdate ? "updated" : "created"} ✓\n\nThis file will be loaded into every session in this workspace. Edit it anytime to refine the context.\n\n\`\`\`\n${content.slice(0, 600)}${content.length > 600 ? "\n… (truncated)" : ""}\n\`\`\``,
      };
    } catch (e: any) {
      return { handled: true, assistantMessage: `Init failed: ${e.message}` };
    }
  }

  // Agent commands — /agents picker, /agent <id>, direct /<agent-id>
  if (trimmed === "/agents" || trimmed === "/agent") {
    return { handled: true, openAgentPicker: true };
  }

  if (trimmed === "/agent off" || trimmed === "/agent none") {
    return {
      handled: true,
      activateAgent: null,
      assistantMessage: "Agent deactivated. Back to default ORI mode.",
    };
  }

  // Direct agent activation: /ui-designer, /backend, etc.
  // Also handles /agent <id>
  const agentCandidateId = trimmed.startsWith("/agent ")
    ? trimmed.slice(7).trim()
    : trimmed.slice(1); // strip leading /

  if (agentCandidateId) {
    const allAgents = await loadAllAgents();
    const match = findAgent(agentCandidateId, allAgents);
    if (match) {
      const wasActive = options.activeAgentId === match.id;
      if (wasActive) {
        return {
          handled: true,
          activateAgent: null,
          assistantMessage: `${match.emoji} ${match.name} deactivated.`,
        };
      }
      return {
        handled: true,
        activateAgent: match.id,
        assistantMessage: `${match.emoji} **${match.name}** activated.\n\n${match.description}`,
      };
    }
  }

  if (trimmed === "/compact") {
    const conversation = options.conversation ?? [];
    if (conversation.length < 4) {
      return { handled: true, assistantMessage: "Nothing to compact yet — conversation is short." };
    }
    const transcript = conversation
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => `${m.role === "user" ? "User" : "ORI"}: ${String(m.content).slice(0, 400)}`)
      .join("\n");
    try {
      const summaryResp = await options.client.createChatCompletion(options.surface, {
        model: undefined,
        messages: [
          {
            role: "system",
            content: "You are a conversation compactor. Summarize the following conversation into a concise context block (max 300 words) that preserves all decisions made, files changed, current objectives, and any unresolved issues. Output only the summary, no preamble.",
          },
          { role: "user", content: transcript },
        ],
      });
      const summary = summaryResp.choices?.[0]?.message?.content ?? "";
      if (!summary) {
        return { handled: true, assistantMessage: "Compact failed — ORI returned no summary." };
      }
      const compacted: import("../runtime/types").OriMessage[] = [
        { role: "system", content: `[COMPACTED CONTEXT]\n${summary}` },
      ];
      return {
        handled: true,
        assistantMessage: `Session compacted. Summary:\n\n${summary}`,
        clearTranscript: true,
        compactedConversation: compacted,
      };
    } catch {
      return { handled: true, assistantMessage: "Compact failed — could not reach ORI." };
    }
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

