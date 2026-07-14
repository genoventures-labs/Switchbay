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
  ChatMessage,
  ToolDefinition as RuntimeToolDefinition,
} from "../runtime/types";
import { createMcpToolRuntime } from "../runtime/mcp-client";
import {
  AGENT_TOOLS,
  type AgentToolExecution,
  executeToolCall,
} from "./tools";
import {
  loadAllAgents,
  findAgent,
  agentSystemPrompt,
  buildAgentDefinition,
} from "./agents";
import { buildToolboxPromptBlock, loadToolboxInventory } from "../toolbox/hub";
import { loadEngineRegistry } from "../engines/registry";
import { buildMemoryPromptBlock } from "../memory/store";
import { buildKnowledgePromptBlock } from "../knowledge/store";
import { buildGuidesPromptBlock, generateRuleDraft, type RuleDraftAnswers, type PendingRuleDraft } from "../context/guides";
import type { RuntimeLane, ToolMode } from "../config/env";
import { buildSwitchbayMcpPromptBlock, formatIntegrationLabel, loadSwitchbayMcpConfig } from "../runtime/mcp-config";
import { loadPluginInventory } from "../plugins/registry";
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
import { createDefaultSwitchbayMcpConfig, switchbayMcpConfigPath } from "../runtime/mcp-config";
import { describeTrustedMcpCatalog, matchTrustedMcpCatalog, TRUSTED_MCP_CATALOG } from "../runtime/mcp-catalog";
import { normalizePluginManifest, pluginManifestTemplate } from "../plugins/registry";

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

export type PendingEngineDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

export type PendingSkillDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

export type PendingPluginDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

export type PendingMcpDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

export type { PendingRuleDraft, RuleDraftAnswers };

export async function generateAgentDefinition(
  client: ChatRuntimeClient,
  surface: string,
  answers: { name: string; specialty: string; approach: string; rules: string },
): Promise<PendingAgentDraft> {
  void client;
  void surface;
  return buildAgentDefinition({
    name: answers.name,
    specialty: answers.specialty,
    approach: answers.approach,
    rules: answers.rules,
    scope: "workspace",
  });
}

export async function generateSkillDefinition(
  client: ChatRuntimeClient,
  surface: string,
  answers: { name: string; purpose: string; triggers: string; method: string; guardrails: string },
): Promise<PendingSkillDraft> {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const prompt = `Create a Switchbay skill markdown file.

Output ONLY markdown with YAML frontmatter. No preamble.

Required format:
---
id: ${id}
name: ${answers.name}
description: one concise sentence
languages: [any]
agents: [any]
tags: [short, useful, tags]
triggers: [words or phrases that should activate this skill]
---

# ${answers.name}

## Use When

- ...

## Inputs

- ...

## Method

1. ...

## Output

- ...

## Guardrails

- ...

Brief:
- Purpose: ${answers.purpose}
- Trigger signals: ${answers.triggers || "Infer sensible trigger signals"}
- Preferred method/checklist: ${answers.method || "Create a practical repeatable workflow"}
- Guardrails: ${answers.guardrails || "Use normal Switchbay local-work safety defaults"}`;

  const resp = await client.createChatCompletion(surface, {
    model: undefined,
    messages: [
      {
        role: "system",
        content: "You write concise reusable Skills for local coding agents. Output only the markdown file content.",
      },
      { role: "user", content: prompt },
    ],
  });

  const content = stripMarkdownFence(extractAssistantText(resp).trim());
  if (!content) throw new Error("The model returned no skill content.");
  const savePath = join(workspaceStorageDir(process.cwd()), "toolbox", "skills", `${id}.skill.md`);
  return { id, name: answers.name, content: `${content}\n`, savePath };
}

export async function generatePluginDefinition(
  answers: { name: string; purpose: string; contents: string; notes: string },
  cwd = process.cwd(),
): Promise<PendingPluginDraft> {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  if (!id) throw new Error("Plugin name needs at least one letter or number.");

  const description = [
    answers.purpose.trim(),
    answers.contents.trim() ? `Intended contents: ${answers.contents.trim()}` : "",
    answers.notes.trim() ? `Notes: ${answers.notes.trim()}` : "",
  ].filter(Boolean).join(" ");

  const manifest = normalizePluginManifest(pluginManifestTemplate(id, answers.name.trim(), description));
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const savePath = join(workspaceStorageDir(cwd), "plugins", manifest.id, "plugin.json");
  return { id: manifest.id, name: manifest.name, content, savePath };
}

export async function generateRuleDefinition(
  answers: RuleDraftAnswers,
  cwd = process.cwd(),
): Promise<PendingRuleDraft> {
  if (!answers.name.trim()) throw new Error("Rule name is required.");
  if (!answers.rule.trim()) throw new Error("Rule text is required.");
  return generateRuleDraft(answers, cwd);
}

export async function generateEngineManifest(
  client: ChatRuntimeClient,
  surface: string,
  answers: { name: string; purpose: string; tools: string; commands: string; approval: string },
): Promise<PendingEngineDraft> {
  const id = answers.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const prompt = `Create a Switchbay engine manifest JSON object.

Engine manifests have this TypeScript shape:
{
  "id": "letters-numbers-hyphens",
  "name": "Human Name",
  "description": "Short practical description",
  "cwd": ".",
  "tools": [
    {
      "name": "tool_name",
      "description": "What this tool does",
      "command": "shell command with {{param}} placeholders",
      "parameters": { "param": { "type": "string", "description": "..." } },
      "required": ["param"],
      "approval": "auto" | "always",
      "approval_reason": "Why approval is needed, only when always"
    }
  ]
}

Rules:
- Output ONLY valid JSON. No markdown fences.
- Use lowercase ids/tool names with hyphens or underscores only.
- Prefer commands that can run from the workspace root.
- Use {{param}} placeholders for user-provided values.
- Mark destructive/publishing/payment/external-impact commands with "approval": "always".
- Keep read-only/list/status commands "auto".
- Create 2-5 useful tools unless the brief clearly needs fewer.

Brief:
- Name: ${answers.name}
- Purpose: ${answers.purpose}
- Desired tools: ${answers.tools}
- Known commands/scripts/APIs: ${answers.commands || "None supplied"}
- Approval/safety notes: ${answers.approval || "Use normal Switchbay safety defaults"}`;

  const resp = await client.createChatCompletion(surface, {
    model: undefined,
    messages: [
      {
        role: "system",
        content: "You write strict JSON Switchbay engine manifests. Output valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = extractAssistantText(resp).trim();
  if (!raw) throw new Error("The model returned no manifest.");
  const manifest = JSON.parse(stripJsonFence(raw));
  const normalized = {
    ...manifest,
    id: manifest.id || id,
    name: manifest.name || answers.name,
  };
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const savePath = join(workspaceStorageDir(process.cwd()), "engines", `${normalized.id}.engine.json`);
  return { id: normalized.id, name: normalized.name, content, savePath };
}

export async function generateSwitchbayMcpConfig(
  _client: ChatRuntimeClient,
  _surface: string,
  answers: { name: string; purpose: string; servers: string; integrations: string; notes: string },
): Promise<PendingMcpDraft> {
  const requestedForCatalog = [
    answers.name,
    answers.purpose,
    answers.servers,
    answers.integrations,
  ].join(" ");
  const matched = uniqueTrustedMcpMatches([
    ...matchTrustedMcpCatalog(requestedForCatalog),
    ...parseIntegrationHints(answers.integrations).flatMap((hint) =>
      TRUSTED_MCP_CATALOG.filter((entry) => entry.integration === hint || entry.id === hint.replace(/^mcp\//, "")),
    ),
  ]);

  if (matched.length === 0) {
    throw new Error([
      "No trusted MCP catalog match found for that request.",
      "Switchbay will not invent MCP server ids.",
      "",
      "Trusted options:",
      describeTrustedMcpCatalog(),
      "",
      "Best next step: add the exact integration id manually to `~/.switchbay/mcp.json`.",
    ].join("\n"));
  }

  const parsed = {
    integrations: matched.map((entry) => entry.integration),
    mcpServers: {},
  };
  const normalized = {
    ...createDefaultSwitchbayMcpConfig(),
    ...parsed,
    enabled: true,
  };
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  return {
    id: "mcp",
    name: answers.name || "Switchbay MCP",
    content,
    savePath: switchbayMcpConfigPath(process.cwd()),
  };
}

function parseIntegrationHints(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueTrustedMcpMatches(entries: typeof TRUSTED_MCP_CATALOG): typeof TRUSTED_MCP_CATALOG {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function stripJsonFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export type BuiltTurn = {
  mode: AgentMode;
  objective: string;
  pendingPlan: string[];
  request: ChatCompletionRequest;
  resolvedProfile: string;
  toolMode?: ToolMode;
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
    lower === "switchbay returned no assistant text for this turn."
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
  transcript: ChatMessage[];
  workspace: WorkspaceSnapshot | null;
  activeAgentId?: string | null;
  runtimeLane?: RuntimeLane;
  toolMode?: ToolMode;
}): Promise<BuiltTurn> {
  const mode = (input.mode as AgentMode) || "build";
  const objective = input.input.slice(0, 100);
  const cwd = input.workspace?.cwd || process.cwd();
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

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
  const knowledgeBlock = await buildKnowledgePromptBlock(input.input, cwd);

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
  const capabilityDirectoryBlock = await buildCapabilityDirectoryPromptBlock(cwd, input.activeAgentId);
  const guidesBlock = await buildGuidesPromptBlock(cwd);
  const effectiveToolMode: ToolMode = input.toolMode === "switchbay-mcp" || input.runtimeLane === "cloud-mcp"
    ? "switchbay-mcp"
    : "standard";
  const switchbayMcpBlock = effectiveToolMode === "switchbay-mcp"
    ? buildSwitchbayMcpPromptBlock(await loadSwitchbayMcpConfig(cwd), input.runtimeLane ?? "cloud")
    : "";

  let systemPrompt = `You are a local-first coding agent running inside a terminal switchbay.
Current Mode: ${mode}
Current Profile: ${input.profile}
Current Workspace: ${cwd}
Current Local Date: ${currentDate}
Runtime Lane: ${input.runtimeLane ?? "cloud"}
Tool Mode: ${effectiveToolMode}
Identity: Speak as the model you actually are. Switchbay owns the workspace, tools, memory, safety gates, and working standards; it is not a fictional assistant identity.${oriMdBlock}${memoryBlock}${knowledgeBlock}${pinsBlock}${agentBlock}${capabilityDirectoryBlock}${toolboxBlock}${guidesBlock}${switchbayMcpBlock}

GROUNDING RULES:
1. You are running inside a local development tool.
2. Runtime lane and profile may influence style, but the current workspace is the active world.
3. Strictly focus on the local filesystem and the current repository context.
4. Do not recite broad host infrastructure, global host configurations, or unrelated platform metadata unless explicitly asked to inspect the host environment.
5. Your primary mission is to understand, plan, and execute changes within the current workspace path: ${cwd}.
6. Treat sibling repos and shared host state as out of scope unless the user explicitly asks to cross that boundary.
7. Be extremely concise and direct.
8. If the user addresses GPT, Claude, Gemini, or another selected model by name, respond naturally as that model. Do not adopt a fictional assistant identity that conflicts with the provider's identity.
9. DO NOT NARRATE your tool usage or internal reasoning steps in your final response to the user. (e.g. avoid "I have checked the files and found..."). Just state the findings or provide the answer directly.
10. If a user asks to enter, inspect, or continue in another project, call workspace_hop before reading files or running commands there. Finding a path is not the same as changing the active workspace.
11. If grounding tools fail, report the failure and stop. Never fabricate a repository snapshot, package metadata, git state, or file contents after failed reads or commands.
12. For Gumroad data, use typed gumroad_* tools, not generic run_engine_tool. gumroad_sales_summary is all-time only. For weekly, month-to-date, or date-specific reporting, use gumroad_sales_range with an explicit YYYY-MM-DD range. If the user says only "weekly" and does not identify the week, ask which date range they mean; never invent it.
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

  const messages: ChatMessage[] = [
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
    toolMode: effectiveToolMode,
  };
}

async function buildCapabilityDirectoryPromptBlock(cwd: string, activeAgentId?: string | null): Promise<string> {
  const [agents, toolbox, registry, plugins, mcp] = await Promise.all([
    loadAllAgents(cwd),
    loadToolboxInventory(cwd),
    loadEngineRegistry(cwd),
    loadPluginInventory(cwd),
    loadSwitchbayMcpConfig(cwd),
  ]);
  const agentLines = agents.map((agent) =>
    `- ${agent.id}: ${agent.name}${agent.id === activeAgentId ? " [ACTIVE]" : ""} — ${agent.description}${agent.path ? ` — file: ${agent.path}` : " — built-in instructions already available"}`
  );
  const skillLines = toolbox.skills.map((skill) =>
    `- ${skill.id}: ${skill.name} — ${skill.description} — file: ${skill.path}`
  );
  const engineLines = registry.engines.map((engine) =>
    `- ${engine.id}: ${engine.name} — ${engine.description} — tools: ${engine.tools.map((tool) => tool.name).join(", ") || "none"}${engine.cwd ? ` — dir: ${engine.cwd}` : ""}`
  );
  const pluginLines = plugins.plugins.map((plugin) => {
    const manifest = plugin.manifest;
    const assets = [
      manifest.agents.length ? `agents:${manifest.agents.length}` : "",
      manifest.skills.length ? `skills:${manifest.skills.length}` : "",
      manifest.engines.length ? `engines:${manifest.engines.length}` : "",
      manifest.guides.length ? `guides:${manifest.guides.length}` : "",
      manifest.knowledge.length ? `knowledge:${manifest.knowledge.length}` : "",
      manifest.mcp.length ? `mcp:${manifest.mcp.length}` : "",
    ].filter(Boolean).join(", ") || "no assets";
    return `- ${manifest.id}: ${manifest.name} [${manifest.enabled ? "enabled" : "disabled"}] — ${manifest.description || "Switchbay plugin"} — manifest: ${plugin.manifestPath} — ${assets}`;
  });
  const mcpLines = mcp.integrations.map((integration) => `- ${formatIntegrationLabel(integration)} — config: ${mcp.path}`);

  return `\n\nCAPABILITY DIRECTORY (authoritative inventory; inspect before claiming a capability is absent):
Agents:\n${agentLines.join("\n") || "- none"}
Skills:\n${skillLines.join("\n") || "- none"}
Engines:\n${engineLines.join("\n") || "- none"}
Plugins:\n${pluginLines.join("\n") || `- none — directory: ${plugins.path}`}
MCP Integrations:\n${mcpLines.join("\n") || `- none — config: ${mcp.path}`}

CAPABILITY SELECTION RULES:
1. Distinguish agents (specialist operating instructions), skills (reusable methods), engines (executable tool packages), plugins (bundles that contribute assets), and MCP integrations (configured external tool bridges).
2. When the user names one, match it against this directory before guessing its type. Never report an agent as a missing engine.
3. For an unassigned task, choose the smallest relevant capability set. Read a listed file with read_file when its detailed instructions are needed; list its containing directory when discovery is useful.
4. Follow selected agent or skill instructions for the current turn. Invoke engine tools only when execution is needed.
5. Plugins are containers: inspect their manifest and then use the contributed agent, skill, engine, guide, knowledge, or MCP asset. Disabled plugins are discoverable but not usable.
6. MCP integrations are usable only when configured and the active tool bridge exposes the needed operation. Never invent an MCP tool from its name alone.
7. Rules, quick-starts, memory, workspace knowledge, and templates are context resources, not agents or engines. Consult them without mislabeling them as an executed capability.
8. In the user-facing response, disclose material capability use on one compact line: "Using: agent/<id> · skill/<id> · engine/<id> · plugin/<id> · mcp/<id>". Omit categories not used. Do not claim a capability you did not inspect or apply.`;
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
  onStreamReset?: (draft: string) => void;
  onTokens?: (count: number) => void;
  onRoute?: (response: ChatCompletionResponse) => void;
  maxIterations?: number;
  signal?: AbortSignal;
}): Promise<ExecutedTurn> {
  const toolExecutions: AgentToolExecution[] = [];
  let currentCwd = input.cwd ?? process.cwd();
  const messages: ChatMessage[] = [...input.turn.request.messages];
  const MAX_ITERATIONS = input.maxIterations ?? 24;
  let emptyReplyRetries = 0;
  const MAX_EMPTY_REPLY_RETRIES = 1;

  const { loadEngineRegistry } = await import("../engines/registry");
  const registry = await loadEngineRegistry(input.cwd ?? process.cwd());
  const hasGumOps = registry.engines.some((e) => e.id === "gumops");
  const hasThinkapse = registry.engines.some((e) => e.id === "thinkapse");

  let filteredTools: RuntimeToolDefinition[] = AGENT_TOOLS;
  if (!hasGumOps || !hasThinkapse) {
    filteredTools = AGENT_TOOLS.filter((t) => {
      const name = t.function?.name ?? "";
      if (!hasGumOps && (
        name.startsWith("gumops_") ||
        name.startsWith("gumroad_") ||
        name.startsWith("facebook_") ||
        name.startsWith("shopify_")
      )) {
        return false;
      }
      if (!hasThinkapse && name.startsWith("thinkapse_")) {
        return false;
      }
      return true;
    });
  }

  const mcpRuntime = input.turn.toolMode === "switchbay-mcp"
    ? await createMcpToolRuntime(input.cwd ?? process.cwd())
    : null;
  if (mcpRuntime) filteredTools = [...filteredTools, ...mcpRuntime.tools];

  try {
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    if (input.signal?.aborted) throw new DOMException("Turn cancelled", "AbortError");
    const request: ChatCompletionRequest = {
      ...input.turn.request,
      messages,
      tools: filteredTools,
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
    input.onRoute?.(response);

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
      const groundingFailure = unresolvedGroundingFailure(toolExecutions);
      if (groundingFailure) {
        return {
          response: {
            ...response,
            choices: [{
              message: { role: "assistant", content: `I couldn't ground this request because **${groundingFailure.tool}** failed: ${groundingFailure.body}\n\nI stopped rather than inventing a workspace summary.` },
              finish_reason: "stop",
            }],
          },
          toolExecutions,
        };
      }
      if (input.onStep) input.onStep("Done.");
      return { response, toolExecutions };
    }


    // Providers may stream a short preamble before deciding to call tools.
    // That draft is not the final answer, so remove it before the tool round.
    input.onStreamReset?.(cleanedText);

    messages.push({
      role: "assistant",
      content: inlineToolCalls.length > 0 ? cleanedText : (assistantMessage?.content ?? ""),
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      if (input.signal?.aborted) throw new DOMException("Turn cancelled", "AbortError");
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

      const result = mcpRuntime?.owns(toolName)
        ? await mcpRuntime.call(toolName, args, input.signal)
        : await executeToolCall(toolName, args, { cwd: currentCwd });
      if (result.travel?.toPath) currentCwd = result.travel.toPath;

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

  const summary = summarizeToolLimit(input.turn.objective, toolExecutions);
  return {
    response: { choices: [{ message: { role: "assistant", content: summary }, finish_reason: "length" }] },
    toolExecutions,
  };
  } finally {
    await mcpRuntime?.close();
  }
}

function unresolvedGroundingFailure(executions: AgentToolExecution[]): AgentToolExecution | null {
  const grounding = /^(workspace_hop|read_file|read_file_range|read_json|summarize_file|list_directory|glob_files|search_files|git_status|git_log|git_show|shell)$/;
  for (let index = executions.length - 1; index >= 0; index -= 1) {
    const execution = executions[index]!;
    if (!grounding.test(execution.tool)) continue;
    if (execution.ok) return null;
    return execution;
  }
  return null;
}

function summarizeToolLimit(objective: string, toolExecutions: AgentToolExecution[]): string {
  const completed = toolExecutions.filter((execution) => execution.ok);
  const failed = toolExecutions.filter((execution) => !execution.ok);
  const recentCompleted = completed.slice(-5).map((execution) => `- ${execution.summary}`);
  const recentFailed = failed.slice(-3).map((execution) => `- ${execution.summary}`);

  const lines = [
    `Switchbay paused after ${toolExecutions.length} tool step${toolExecutions.length === 1 ? "" : "s"} while working on: ${objective}`,
  ];

  if (recentCompleted.length > 0) {
    lines.push("", "Recent completed work:", ...recentCompleted);
  }

  if (recentFailed.length > 0) {
    lines.push("", "Recent tool issues:", ...recentFailed);
  }

  lines.push("", "Say `continue` and I will pick up from this checkpoint.");
  return lines.join("\n");
}
