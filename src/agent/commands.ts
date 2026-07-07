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
import type { ChatMessage } from "../runtime/types";
import type { WorkspaceSnapshot } from "../session/workspace";
import type { PatchPreview } from "../tools/patch";
import { runCommand } from "../tools/shell";
import { findAgent, loadAllAgents } from "./agents";
import { extractAssistantText } from "./loop";
import { describeEngines, loadEngineRegistry } from "../engines/registry";
import { describeEngineBay, loadEngineBayInventory } from "../engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "../toolbox/hub";
import { createDefaultLmStudioMcpConfig, describeLmStudioMcpConfig, loadLmStudioMcpConfig, saveLmStudioMcpConfig } from "../runtime/lmstudio-mcp-config";
import {
  addMemoryNote,
  describeMemory,
  forgetMemoryNote,
  listMemoryNotes,
  readMemoryFacts,
  refreshMemory,
} from "../memory/store";

export type LocalCommandResult = {
  handled: boolean;
  assistantMessage?: string;
  workspace?: WorkspaceSnapshot;
  patch?: PatchPreview;
  changedFile?: string;
  clearTranscript?: boolean;
  compactedConversation?: ChatMessage[];
  activateAgent?: string | null;
  openAgentPicker?: boolean;
  openCreateAgent?: boolean;
  openCreateEngine?: boolean;
  openCreateMcp?: boolean;
  openCreateSkill?: boolean;
  openEnginePicker?: boolean;
  openSkillPicker?: boolean;
  planGoal?: string;
  checkpointOp?: { op: "create"; name: string } | { op: "list" } | { op: "restore"; index: number };
  travel?: { toPath: string; label: string; workspace: WorkspaceSnapshot };
  followUpInput?: string;
};

export type LocalCommandOptions = {
  activeAgentId?: string | null;
  client: ChatRuntimeClient;
  conversation?: ChatMessage[];
  lastChangedFile?: string | null;
  profile: string;
  sessionId: string;
  surface: string;
  workspace: WorkspaceSnapshot | null;
};

export function parseApprovalIntent(input: string): "apply" | "cancel" | "always" | null {
  const normalized = input.trim().toLowerCase();
  if (["2", "y", "yes"].includes(normalized)) return "apply";
  if (["1", "n", "no"].includes(normalized)) return "cancel";
  if (["3", "always", "yes always", "y always"].includes(normalized)) return "always";
  return null;
}

export async function tryLocalCommand(
  input: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    const creationIntent = parseConversationalCreationIntent(trimmed);
    if (creationIntent === "agent") return { handled: true, openCreateAgent: true };
    if (creationIntent === "engine") return { handled: true, openCreateEngine: true };
    if (creationIntent === "mcp") return { handled: true, openCreateMcp: true };
    if (creationIntent === "skill") return { handled: true, openCreateSkill: true };
    return { handled: false };
  }

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

  if (trimmed === "/create-engine") {
    return { handled: true, openCreateEngine: true };
  }

  if (trimmed === "/create-mcp") {
    return { handled: true, openCreateMcp: true };
  }

  if (trimmed === "/create-skill") {
    return { handled: true, openCreateSkill: true };
  }

  if (trimmed === "/mcp" || trimmed.startsWith("/mcp ")) {
    return handleMcpCommand(trimmed, options);
  }

  if (trimmed === "/engines") {
    return { handled: true, openEnginePicker: true };
  }

  if (trimmed === "/engines list") {
    const cwd = options.workspace?.cwd ?? process.cwd();
    return { handled: true, assistantMessage: await describeEngines(cwd) };
  }

  if (trimmed === "/engine-bay" || trimmed.startsWith("/engine-bay ")) {
    return handleEngineBayCommand(trimmed);
  }

  if (trimmed === "/toolbox" || trimmed.startsWith("/toolbox ")) {
    return handleToolboxCommand(trimmed);
  }

  if (trimmed === "/skills") {
    return { handled: true, openSkillPicker: true };
  }

  if (trimmed.startsWith("/skills ")) {
    return handleToolboxCommand(`/toolbox${trimmed.slice("/skills".length)}`);
  }

  if (trimmed === "/creative") {
    return handleCreativeCommand(options);
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

  if (trimmed === "/memory" || trimmed.startsWith("/memory ")) {
    return handleMemoryCommand(trimmed, options);
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

function parseConversationalCreationIntent(input: string): "agent" | "engine" | "mcp" | "skill" | null {
  const normalized = input
    .toLowerCase()
    .replace(/^[,\s]*(hey|yo|ok|okay)?\s*(bay|switchbay)[,\s:;-]*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  const wantsCreate = /\b(create|make|build|add|setup|set up|scaffold|draft|generate)\b/.test(normalized);
  if (!wantsCreate) return null;

  if (/\b(agent|specialist|persona)\b/.test(normalized)) return "agent";
  if (/\b(mcp|mcp config|mcp lane|lm studio mcp|lmstudio mcp|tool server|tool servers)\b/.test(normalized)) return "mcp";
  if (/\b(engine|engine builder|engine manifest|tool engine)\b/.test(normalized)) return "engine";
  if (/\b(skill|toolbox skill|workflow|checklist)\b/.test(normalized)) return "skill";
  return null;
}

async function handleMcpCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const action = trimmed.slice("/mcp".length).trim().toLowerCase();
  try {
    if (action === "init") {
      const path = await saveLmStudioMcpConfig(createDefaultLmStudioMcpConfig(), cwd);
      return {
        handled: true,
        assistantMessage: `Created LM Studio MCP config at \`${path}\`.\n\nEdit it to match the MCP servers installed in LM Studio, then switch with \`/lane mcp\`.`,
      };
    }

    if (action === "create") {
      return { handled: true, openCreateMcp: true };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/mcp [status|init|create]`" };
    }

    return { handled: true, assistantMessage: describeLmStudioMcpConfig(await loadLmStudioMcpConfig(cwd)) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `LM Studio MCP config failed: ${e.message}` };
  }
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
  const prompt = `You are generating a ${PROJECT_CONTEXT_FILE} file for a software project. This file is injected at the top of every coding switchbay session for this workspace — it is the agent's persistent project context.

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

async function handleCreativeCommand(options: LocalCommandOptions): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const registry = await loadEngineRegistry(cwd);
  const creative = registry.engines.find((engine) => engine.id === "creative");
  if (!creative) {
    return { handled: true, assistantMessage: "Creative Engine is not available in this workspace." };
  }

  const tools = creative.tools
    .map((tool) => `- \`${tool.name}\` - ${tool.description}`)
    .join("\n");
  return {
    handled: true,
    assistantMessage: [
      "**Creative Engine**",
      "",
      creative.description,
      "",
      tools,
      "",
      "Saved outputs:",
      "- `.switchbay/creative/briefs/`",
      "- `.switchbay/creative/packets/`",
      "- `.switchbay/creative/drafts/`",
      "- `.switchbay/creative/voices/`",
      "",
      "Ask for a creative packet when you want the full brief, positioning, names, hooks, draft, and calendar bundle.",
    ].join("\n"),
  };
}

async function handleEngineBayCommand(trimmed: string): Promise<LocalCommandResult> {
  const action = trimmed.slice("/engine-bay".length).trim();
  try {
    if (action === "sync") {
      return { handled: true, assistantMessage: await describeEngineBay(true) };
    }

    const inventory = await loadEngineBayInventory();
    if (action === "templates") {
      return {
        handled: true,
        assistantMessage: inventory.templates.length
          ? inventory.templates.map((item) => `- \`${item}\``).join("\n")
          : "No Engine Bay templates found. Run `/engine-bay sync`.",
      };
    }

    if (action === "list") {
      const items = [...inventory.manifests, ...inventory.engineFiles];
      return {
        handled: true,
        assistantMessage: items.length
          ? items.map((item) => `- \`${item}\``).join("\n")
          : "No Engine Bay files found. Run `/engine-bay sync`.",
      };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/engine-bay [status|sync|list|templates]`" };
    }

    return { handled: true, assistantMessage: await describeEngineBay(false) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Engine Bay failed: ${e.message}` };
  }
}

async function handleToolboxCommand(trimmed: string): Promise<LocalCommandResult> {
  const parts = trimmed.slice("/toolbox".length).trim().split(/\s+/).filter(Boolean);
  const action = parts[0] ?? "status";
  try {
    if (action === "sync") {
      return { handled: true, assistantMessage: await describeToolbox(true) };
    }

    const inventory = await loadToolboxInventory();
    if (action === "templates") {
      return {
        handled: true,
        assistantMessage: inventory.templates.length
          ? inventory.templates.map((item) => `- \`${item}\``).join("\n")
          : "No Toolbox templates found. Run `/toolbox sync`.",
      };
    }

    if (action === "list") {
      return {
        handled: true,
        assistantMessage: inventory.skills.length
          ? inventory.skills.map((skill) => `- \`${skill.id}\` - **${skill.name}**: ${skill.description}`).join("\n")
          : "No Toolbox skills found.",
      };
    }

    if (action === "read") {
      const skillId = parts[1];
      if (!skillId) return { handled: true, assistantMessage: "Usage: `/toolbox read <skill-id>`" };
      const skill = await readToolboxSkill(skillId);
      return {
        handled: true,
        assistantMessage: skill ? skill.body : `Toolbox skill not found: \`${skillId}\``,
      };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/toolbox [status|sync|list|templates|read <skill-id>]`" };
    }

    return { handled: true, assistantMessage: await describeToolbox(false) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Toolbox failed: ${e.message}` };
  }
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
  try {
    const count = await addMemoryNote(cwd, note);
    return { handled: true, assistantMessage: `Remembered: _${note}_\n\n${count} note${count !== 1 ? "s" : ""} in memory.` };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Failed to save: ${e.message}` };
  }
}

async function handleMemoriesCommand(options: LocalCommandOptions): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  try {
    const notes = await listMemoryNotes(cwd);
    if (!notes.length) return { handled: true, assistantMessage: "Memory is empty. Add notes with `/remember`." };
    const indexed = notes.map((note, i) => `${i}. ${note}`).join("\n");
    return { handled: true, assistantMessage: `**Memory** (${notes.length} notes):\n\n${indexed}\n\nRemove with \`/forget <n>\`` };
  } catch {
    return { handled: true, assistantMessage: "Memory is empty. Add notes with `/remember`." };
  }
}

async function handleForgetCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const indexStr = trimmed.slice("/forget".length).trim();
  const index = parseInt(indexStr, 10);
  if (isNaN(index)) return { handled: true, assistantMessage: "Usage: `/forget <index>` — use `/memories` to see indices." };
  const cwd = options.workspace?.cwd ?? process.cwd();
  try {
    const removed = await forgetMemoryNote(cwd, index);
    if (!removed) return { handled: true, assistantMessage: `No memory at index ${index}. Run \`/memories\` to list.` };
    const remaining = (await listMemoryNotes(cwd)).length;
    return { handled: true, assistantMessage: `Forgot: _${removed}_\n\n${remaining} note${remaining !== 1 ? "s" : ""} remaining.` };
  } catch {
    return { handled: true, assistantMessage: "Memory is empty — nothing to forget." };
  }
}

async function handleMemoryCommand(trimmed: string, options: LocalCommandOptions): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const parts = trimmed.slice("/memory".length).trim().split(/\s+/).filter(Boolean);
  const action = parts[0] ?? "status";
  try {
    if (action === "status") return { handled: true, assistantMessage: await describeMemory(cwd) };
    if (action === "refresh") return { handled: true, assistantMessage: `Memory refreshed.\n\n${await refreshMemory(cwd)}` };
    if (action === "facts") {
      const facts = await readMemoryFacts(cwd);
      return {
        handled: true,
        assistantMessage: facts.length
          ? facts.map((fact) => `- \`${fact.key}\`: ${fact.value}`).join("\n")
          : "No memory facts yet. Run `/memory refresh`.",
      };
    }
    if (action === "read") return { handled: true, assistantMessage: await describeMemory(cwd) };
    return { handled: true, assistantMessage: "Usage: `/memory [status|refresh|facts|read]`" };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Memory failed: ${e.message}` };
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
