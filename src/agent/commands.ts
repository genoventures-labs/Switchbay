import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_STORAGE_DIR,
  PROJECT_CONTEXT_FILE,
  existingProjectContextPath,
  existingWorkspaceDataPath,
  projectContextPath,
  workspaceDataPath,
  workspaceStorageDir,
} from "../config/paths";
import type { ChatRuntimeClient } from "../runtime/client";
import type { OriMessage } from "../runtime/types";
import type { WorkspaceSnapshot } from "../session/workspace";
import type { PatchPreview } from "../tools/patch";
import { runCommand } from "../tools/shell";
import { findAgent, loadAllAgents } from "./agents";
import { extractAssistantText } from "./loop";

export type LocalCommandResult = {
  handled: boolean;
  assistantMessage?: string;
  workspace?: WorkspaceSnapshot;
  patch?: PatchPreview;
  changedFile?: string;
  clearTranscript?: boolean;
  compactedConversation?: OriMessage[];
  activateAgent?: string | null;
  openAgentPicker?: boolean;
  openCreateAgent?: boolean;
  planGoal?: string;
  checkpointOp?: { op: "create"; name: string } | { op: "list" } | { op: "restore"; index: number };
  travel?: { toPath: string; label: string; workspace: WorkspaceSnapshot };
  followUpInput?: string;
};

export type LocalCommandOptions = {
  activeAgentId?: string | null;
  client: ChatRuntimeClient;
  conversation?: OriMessage[];
  lastChangedFile?: string | null;
  profile: string;
  sessionId: string;
  surface: string;
  workspace: WorkspaceSnapshot | null;
};

export function parseApprovalIntent(input: string): "apply" | "cancel" | null {
  const normalized = input.trim().toLowerCase();
  if (["y", "yes"].includes(normalized)) return "apply";
  if (["n", "no"].includes(normalized)) return "cancel";
  return null;
}

export async function tryLocalCommand(
  input: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) return { handled: false };

  if (trimmed === "/clear") {
    return { handled: true, clearTranscript: true };
  }

  if (trimmed === "/undo-turn") {
    const cwd = options.workspace?.cwd ?? process.cwd();
    try {
      const changedResult = await runCommand(["git", "diff", "HEAD", "--name-only"], cwd);
      const changed = changedResult.ok ? changedResult.stdout : "";
      const files = changed.split("\n").map((f) => f.trim()).filter(Boolean);
      if (!files.length) {
        return { handled: true, assistantMessage: "Nothing to undo — no uncommitted changes vs HEAD." };
      }
      const checkout = await runCommand(["git", "checkout", "HEAD", "--", ...files], cwd);
      if (!checkout.ok) {
        throw new Error(checkout.stderr || checkout.stdout || "git checkout failed");
      }
      const list = files.map((f) => `- \`${f}\``).join("\n");
      return { handled: true, assistantMessage: `Reverted ${files.length} file${files.length !== 1 ? "s" : ""} to HEAD:\n\n${list}` };
    } catch (e: any) {
      return { handled: true, assistantMessage: `Undo failed: ${e.message}` };
    }
  }

  if (trimmed === "/undo") {
    const file = options.lastChangedFile;
    if (!file) {
      return { handled: true, assistantMessage: "Nothing to undo — no file has been changed this session." };
    }
    const cwd = options.workspace?.cwd ?? process.cwd();
    try {
      const checkout = await runCommand(["git", "checkout", "HEAD", "--", file], cwd);
      if (!checkout.ok) {
        throw new Error(checkout.stderr || checkout.stdout || "git checkout failed");
      }
      return { handled: true, assistantMessage: `Undid changes to \`${file}\` — restored to HEAD.` };
    } catch (e: any) {
      return { handled: true, assistantMessage: `Undo failed: ${e.message}` };
    }
  }

  if (trimmed === "/init" || trimmed === "/init --update") {
    return handleInitCommand(trimmed, options);
  }

  if (trimmed === "/create-agent") {
    return { handled: true, openCreateAgent: true };
  }

  if (trimmed === "/agents" || trimmed === "/agent") {
    return { handled: true, openAgentPicker: true };
  }

  if (trimmed === "/agent off" || trimmed === "/agent none") {
    return {
      handled: true,
      activateAgent: null,
      assistantMessage: "Agent deactivated. Back to default mode.",
    };
  }

  if (trimmed.startsWith("/agent ")) {
    const agentCandidateId = trimmed.slice(7).trim();
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

    return {
      handled: true,
      assistantMessage: `No agent found for \`${agentCandidateId}\`. Run \`/agents\` to browse available agents.`,
    };
  }

  if (trimmed === "/review" || trimmed.startsWith("/review ")) {
    return handleReviewCommand(trimmed, options);
  }

  if (trimmed.startsWith("/pin ") || trimmed === "/pin") {
    return handlePinCommand(trimmed, options);
  }

  if (trimmed.startsWith("/unpin ") || trimmed === "/unpin") {
    return handleUnpinCommand(trimmed, options);
  }

  if (trimmed === "/pins") {
    return handlePinsCommand(options);
  }

  if (trimmed.startsWith("/remember ") || trimmed === "/remember") {
    return handleRememberCommand(trimmed, options);
  }

  if (trimmed === "/memories") {
    return handleMemoriesCommand(options);
  }

  if (trimmed.startsWith("/forget ") || trimmed === "/forget") {
    return handleForgetCommand(trimmed, options);
  }

  if (trimmed === "/checkpoint" || trimmed.startsWith("/checkpoint ")) {
    const name = trimmed.slice("/checkpoint".length).trim() || `checkpoint-${Date.now()}`;
    return { handled: true, checkpointOp: { op: "create", name } };
  }

  if (trimmed === "/checkpoints") {
    return { handled: true, checkpointOp: { op: "list" } };
  }

  if (trimmed === "/restore" || trimmed.startsWith("/restore ")) {
    const indexStr = trimmed.slice("/restore".length).trim();
    const index = indexStr ? parseInt(indexStr, 10) : 0;
    return { handled: true, checkpointOp: { op: "restore", index: isNaN(index) ? 0 : index } };
  }

  if (trimmed.startsWith("/plan ") || trimmed === "/plan") {
    const goal = trimmed.slice("/plan".length).trim();
    if (!goal) return { handled: true, assistantMessage: 'Usage: `/plan "describe what you want to accomplish"`' };
    return { handled: true, planGoal: goal };
  }

  if (trimmed === "/stop") {
    return { handled: true, assistantMessage: "Plan stopped.", activateAgent: undefined };
  }

  if (trimmed === "/compact") {
    return handleCompactCommand(options);
  }

  return { handled: false };
}

async function handleInitCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const existingContextPath = existingProjectContextPath(cwd);
  const contextPath = existingContextPath ?? projectContextPath(cwd);
  const isUpdate = trimmed === "/init --update";

  if (existsSync(contextPath) && !isUpdate) {
    return {
      handled: true,
      assistantMessage: `${contextPath.split("/").pop()} already exists in this workspace. Use \`/init --update\` to regenerate it.`,
    };
  }

  const signals = collectProjectSignals(cwd, isUpdate, contextPath);
  const prompt = `You are generating a ${PROJECT_CONTEXT_FILE} file for a software project. This file is injected at the top of every coding harness session for this workspace — it is the agent's persistent project context.

Analyze the project signals below and write a concise, dense ${PROJECT_CONTEXT_FILE}. It should cover:
1. **What this project is** — one tight paragraph, no fluff
2. **Stack** — languages, frameworks, key deps (be specific, include versions if visible)
3. **Key commands** — build, test, run, lint (exact commands)
4. **Project layout** — 5-10 bullet points on the most important dirs/files and what they do
5. **Gotchas & conventions** — things that would trip up a new engineer: naming conventions, env vars, non-obvious config, known footguns
6. **Do not** — anything the agent should never do in this repo (e.g. don't push to main, don't touch X)

Format: use markdown headers (##). Be terse. No filler sentences. Max 400 words.

Project signals:
${signals.join("\n\n")}

Write only the ${PROJECT_CONTEXT_FILE} content, starting with # ${PROJECT_CONTEXT_FILE}`;

  try {
    const resp = await options.client.createChatCompletion(options.surface, {
      model: undefined,
      messages: [
        { role: "system", content: "You are a technical documentation writer. Output only the requested file content, no preamble or explanation." },
        { role: "user", content: prompt },
      ],
    });
    const content = extractAssistantText(resp);
    if (!content) {
      return { handled: true, assistantMessage: "Init failed — the model returned no content." };
    }
    await writeFile(contextPath, content, "utf-8");
    return {
      handled: true,
      assistantMessage: `${contextPath.split("/").pop()} ${isUpdate ? "updated" : "created"} ✓\n\nThis file will be loaded into every session in this workspace. Edit it anytime to refine the context.\n\n\`\`\`\n${content.slice(0, 600)}${content.length > 600 ? "\n… (truncated)" : ""}\n\`\`\``,
    };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Init failed: ${e.message}` };
  }
}

function collectProjectSignals(cwd: string, isUpdate: boolean, contextPath: string): string[] {
  const signals: string[] = [];

  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const names = entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist" && e.name !== ".git")
      .map((e) => e.isDirectory() ? `${e.name}/` : e.name)
      .slice(0, 50);
    signals.push(`Top-level structure:\n${names.join("  ")}`);
  } catch {}

  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    const parts: string[] = [];
    if (pkg.name) parts.push(`name: ${pkg.name}`);
    if (pkg.description) parts.push(`description: ${pkg.description}`);
    if (pkg.scripts) parts.push(`scripts: ${JSON.stringify(pkg.scripts)}`);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (deps.length) parts.push(`dependencies: ${deps.join(", ")}`);
    signals.push(`package.json:\n${parts.join("\n")}`);
  } catch {}

  try {
    const goMod = readFileSync(join(cwd, "go.mod"), "utf-8").split("\n").slice(0, 10).join("\n");
    signals.push(`go.mod:\n${goMod}`);
  } catch {}

  try {
    const cargo = readFileSync(join(cwd, "Cargo.toml"), "utf-8").split("\n").slice(0, 20).join("\n");
    signals.push(`Cargo.toml:\n${cargo}`);
  } catch {}

  for (const readmeName of ["README.md", "README.txt", "README"]) {
    try {
      const readme = readFileSync(join(cwd, readmeName), "utf-8").split("\n").slice(0, 60).join("\n");
      signals.push(`README:\n${readme}`);
      break;
    } catch {}
  }

  if (isUpdate && existsSync(contextPath)) {
    try {
      const existing = readFileSync(contextPath, "utf-8");
      signals.push(`Existing project context file (preserve any hand-edited sections):\n${existing}`);
    } catch {}
  }

  return signals;
}

async function handleReviewCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const focus = trimmed.slice("/review".length).trim();
  try {
    const currentDiff = await runCommand(["git", "diff", "HEAD"], cwd);
    let diff = currentDiff.ok ? currentDiff.stdout : "";
    if (!diff) {
      const previousDiff = await runCommand(["git", "diff", "HEAD~1"], cwd);
      diff = previousDiff.ok ? previousDiff.stdout : "";
    }
    if (!diff) {
      return { handled: true, assistantMessage: "Nothing to review — no uncommitted changes and no previous commit diff." };
    }

    const maxDiff = 8000;
    const truncated = diff.length > maxDiff;
    const diffBlock = truncated ? `${diff.slice(0, maxDiff)}\n\n… [diff truncated]` : diff;
    const focusLine = focus ? ` Focus specifically on ${focus} concerns.` : "";
    const reviewPrompt = `Review the following diff.${focusLine} Structure your feedback as:
1. **Issues** (blocking — must fix before merging)
2. **Suggestions** (non-blocking improvements)
3. **Nits** (style, naming, minor things)

Be specific: cite file and line context. Be direct. Skip praise unless something is genuinely worth noting.

\`\`\`diff
${diffBlock}
\`\`\``;

    return { handled: true, followUpInput: reviewPrompt };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Review failed: ${e.message}` };
  }
}

async function handlePinCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const filePath = trimmed.slice("/pin".length).trim();
  if (!filePath) return { handled: true, assistantMessage: "Usage: `/pin <path>` — e.g. `/pin src/config.ts`" };
  const cwd = options.workspace?.cwd ?? process.cwd();
  const pinsPath = workspaceDataPath(cwd, "pins.json");
  try {
    const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
    await mkdir(workspaceStorageDir(cwd), { recursive: true });
    let pins: string[] = [];
    try { pins = JSON.parse(await rf(existingWorkspaceDataPath(cwd, "pins.json"), "utf-8")); } catch {}
    if (!pins.includes(filePath)) pins.push(filePath);
    await wf(pinsPath, JSON.stringify(pins, null, 2), "utf-8");
    return { handled: true, assistantMessage: `Pinned \`${filePath}\` — will be injected into every turn context.` };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Pin failed: ${e.message}` };
  }
}

async function handleUnpinCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const filePath = trimmed.slice("/unpin".length).trim();
  if (!filePath) return { handled: true, assistantMessage: "Usage: `/unpin <path>`" };
  const cwd = options.workspace?.cwd ?? process.cwd();
  const pinsPath = workspaceDataPath(cwd, "pins.json");
  try {
    const { writeFile: wf } = await import("node:fs/promises");
    let pins: string[] = [];
    try { pins = JSON.parse(readFileSync(existingWorkspaceDataPath(cwd, "pins.json"), "utf-8")); } catch {}
    const filtered = pins.filter((p) => p !== filePath);
    if (filtered.length === pins.length) return { handled: true, assistantMessage: `\`${filePath}\` wasn't pinned.` };
    await wf(pinsPath, JSON.stringify(filtered, null, 2), "utf-8");
    return { handled: true, assistantMessage: `Unpinned \`${filePath}\`.` };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Unpin failed: ${e.message}` };
  }
}

function handlePinsCommand(options: LocalCommandOptions): LocalCommandResult {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const pinsPath = existingWorkspaceDataPath(cwd, "pins.json");
  try {
    const pins: string[] = JSON.parse(readFileSync(pinsPath, "utf-8"));
    if (!pins.length) return { handled: true, assistantMessage: "No pinned files. Use `/pin <path>` to pin one." };
    return { handled: true, assistantMessage: `**Pinned files** (injected every turn):\n\n${pins.map((p) => `- \`${p}\``).join("\n")}\n\nRemove with \`/unpin <path>\`` };
  } catch {
    return { handled: true, assistantMessage: "No pinned files. Use `/pin <path>` to pin one." };
  }
}

async function handleRememberCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const note = trimmed.slice("/remember".length).trim();
  if (!note) return { handled: true, assistantMessage: 'Usage: `/remember "note to keep in mind"`' };
  const cwd = options.workspace?.cwd ?? process.cwd();
  const memPath = workspaceDataPath(cwd, "memory.md");
  try {
    const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
    await mkdir(workspaceStorageDir(cwd), { recursive: true });
    let existing = "";
    try { existing = (await rf(existingWorkspaceDataPath(cwd, "memory.md"), "utf-8")).trim(); } catch {}
    const lines = existing ? existing.split("\n").filter((l) => l.trim()) : [];
    lines.push(`- ${note}`);
    await wf(memPath, `${lines.join("\n")}\n`, "utf-8");
    return { handled: true, assistantMessage: `Remembered: _${note}_\n\n${lines.length} note${lines.length !== 1 ? "s" : ""} in memory.` };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Failed to save: ${e.message}` };
  }
}

function handleMemoriesCommand(options: LocalCommandOptions): LocalCommandResult {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const memPath = existingWorkspaceDataPath(cwd, "memory.md");
  try {
    const content = readFileSync(memPath, "utf-8").trim();
    const lines = content.split("\n").filter((l) => l.trim());
    if (!lines.length) return { handled: true, assistantMessage: "Memory is empty. Add notes with `/remember`." };
    const indexed = lines.map((l, i) => `${i}. ${l.replace(/^-\s*/, "")}`).join("\n");
    return { handled: true, assistantMessage: `**Memory** (${lines.length} notes):\n\n${indexed}\n\nRemove with \`/forget <n>\`` };
  } catch {
    return { handled: true, assistantMessage: "Memory is empty. Add notes with `/remember`." };
  }
}

async function handleForgetCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const indexStr = trimmed.slice("/forget".length).trim();
  const index = parseInt(indexStr, 10);
  if (isNaN(index)) return { handled: true, assistantMessage: "Usage: `/forget <index>` — use `/memories` to see indices." };
  const cwd = options.workspace?.cwd ?? process.cwd();
  const memPath = workspaceDataPath(cwd, "memory.md");
  try {
    const { writeFile: wf } = await import("node:fs/promises");
    const content = readFileSync(existingWorkspaceDataPath(cwd, "memory.md"), "utf-8").trim();
    const lines = content.split("\n").filter((l) => l.trim());
    if (index < 0 || index >= lines.length) {
      return { handled: true, assistantMessage: `No memory at index ${index}. Run \`/memories\` to list.` };
    }
    const removed = (lines[index] ?? "").replace(/^-\s*/, "");
    lines.splice(index, 1);
    await wf(memPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
    return { handled: true, assistantMessage: `Forgot: _${removed}_\n\n${lines.length} note${lines.length !== 1 ? "s" : ""} remaining.` };
  } catch {
    return { handled: true, assistantMessage: "Memory is empty — nothing to forget." };
  }
}

async function handleCompactCommand(options: LocalCommandOptions): Promise<LocalCommandResult> {
  const conversation = options.conversation ?? [];
  if (conversation.length < 4) {
    return { handled: true, assistantMessage: "Nothing to compact yet — conversation is short." };
  }
  const transcript = conversation
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content).slice(0, 400)}`)
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
    const summary = extractAssistantText(summaryResp);
    if (!summary) {
      return { handled: true, assistantMessage: "Compact failed — the model returned no summary." };
    }
    return {
      handled: true,
      assistantMessage: `Session compacted. Summary:\n\n${summary}`,
      clearTranscript: true,
      compactedConversation: [{ role: "system", content: `[COMPACTED CONTEXT]\n${summary}` }],
    };
  } catch {
    return { handled: true, assistantMessage: "Compact failed — could not reach the provider." };
  }
}
