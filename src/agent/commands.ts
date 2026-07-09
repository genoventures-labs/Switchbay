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
import { getRuntimeLane, getToolMode, type RuntimeLane, type ToolMode } from "../config/env";
import { getRuntimeLaneLabel } from "../runtime/client";
import { getActiveCloudProvider } from "../runtime/cloud-providers";
import { getActiveLocalProvider } from "../runtime/local-providers";
import { getSelectedRuntimeModel } from "../config/switchbay-config";
import { addDailyTask, clearDailyBoard, completeDailyTask, describeDailyBoard } from "../operator/daily-board";
import { describeEngines, loadEngineRegistry } from "../engines/registry";
import { describeEngineBay, loadEngineBayInventory } from "../engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "../toolbox/hub";
import { createDefaultLmStudioMcpConfig, describeLmStudioMcpConfig, loadLmStudioMcpConfig, saveLmStudioMcpConfig } from "../runtime/lmstudio-mcp-config";
import { describeTrustedMcpCatalog } from "../runtime/mcp-catalog";
import {
  addMemoryNote,
  describeMemory,
  forgetMemoryNote,
  listMemoryNotes,
  readMemoryFacts,
  refreshMemory,
} from "../memory/store";
import { describeGuides } from "../context/guides";
import {
  describeKnowledgeIndex,
  formatKnowledgeSearchResults,
  refreshKnowledgeIndex,
  searchKnowledgeIndex,
} from "../knowledge/store";
import { describeLatestTrace, latestTraceExportPath } from "../trace/store";
import { describePlugins, readPlugin } from "../plugins/registry";
import { addWhitelistedLocation, resolveLocationInput } from "../config/switchbay-config";
import { fuzzyMatchLocations, listTravelLocations, travelTo } from "../tools/travel";
import { formatWorkspaceContext } from "../session/workspace";
import { formatFrictionRadar, runFrictionRadar } from "../operator/radar";
import { buildQuickHandoff } from "../operator/handoff";

export type LocalCommandResult = {
  handled: boolean;
  assistantMessage?: string;
  workspace?: WorkspaceSnapshot;
  patch?: PatchPreview;
  changedFile?: string;
  clearTranscript?: boolean;
  compactedConversation?: ChatMessage[];
  activateAgent?: string | null;
  dailyBoardChanged?: boolean;
  openAgentPicker?: boolean;
  openCreateAgent?: boolean;
  openCreateEngine?: boolean;
  openCreateMcp?: boolean;
  openCreateRule?: boolean;
  openCreateSkill?: boolean;
  openCreatePlugin?: boolean;
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
  runtimeLane?: RuntimeLane;
  toolMode?: ToolMode;
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
    const workspaceHopIntent = parseConversationalWorkspaceHopIntent(trimmed);
    if (workspaceHopIntent) {
      const result = await handleWorkspaceCommand(`/workspace hop ${workspaceHopIntent.query}`, options);
      if (result.handled && result.travel && workspaceHopIntent.followUp) {
        return { ...result, followUpInput: workspaceHopIntent.followUp };
      }
      return result;
    }

    const creationIntent = parseConversationalCreationIntent(trimmed);
    if (creationIntent === "agent") return { handled: true, openCreateAgent: true };
    if (creationIntent === "engine") return { handled: true, openCreateEngine: true };
    if (creationIntent === "mcp") return { handled: true, openCreateMcp: true };
    if (creationIntent === "rule") return { handled: true, openCreateRule: true };
    if (creationIntent === "skill") return { handled: true, openCreateSkill: true };
    if (creationIntent === "plugin") return { handled: true, openCreatePlugin: true };

    const workspaceReferenceIntent = parseConversationalWorkspaceReferenceIntent(trimmed);
    if (workspaceReferenceIntent) {
      const result = await handleWorkspaceCommand(`/workspace hop ${workspaceReferenceIntent.query}`, options);
      if (result.handled && result.travel) {
        return { ...result, followUpInput: workspaceReferenceIntent.followUp };
      }
      return result;
    }

    const operatorIntent = await handleConversationalOperatorIntent(trimmed, options);
    if (operatorIntent.handled) return operatorIntent;

    return { handled: false };
  }

  if (trimmed === "/clear") {
    return { handled: true, clearTranscript: true };
  }

  if (trimmed === "/agenda" || trimmed === "/today" || trimmed === "/tasks") {
    return { handled: true, assistantMessage: describeDailyBoard() };
  }

  if (trimmed === "/task" || trimmed.startsWith("/task ")) {
    return handleDailyTaskCommand(trimmed);
  }

  if (trimmed === "/workspace" || trimmed.startsWith("/workspace ") || trimmed === "/workspaces" || trimmed.startsWith("/workspaces ")) {
    return handleWorkspaceCommand(trimmed, options);
  }

  if (trimmed === "/hop" || trimmed.startsWith("/hop ")) {
    return handleWorkspaceCommand(`/workspace hop${trimmed.slice("/hop".length)}`, options);
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

  if (trimmed === "/create-plugin") {
    return { handled: true, openCreatePlugin: true };
  }

  if (trimmed === "/create-rule") {
    return { handled: true, openCreateRule: true };
  }

  if (trimmed === "/quickstarts" || trimmed === "/quickstart") {
    const cwd = options.workspace?.cwd ?? process.cwd();
    return { handled: true, assistantMessage: await describeGuides(cwd, "quickstart") };
  }

  if (trimmed === "/index" || trimmed.startsWith("/index ")) {
    return handleKnowledgeCommand(trimmed, options);
  }

  if (trimmed === "/search" || trimmed.startsWith("/search ")) {
    return handleKnowledgeSearchCommand(trimmed, options);
  }

  if (trimmed === "/rules" || trimmed.startsWith("/rules ")) {
    const action = trimmed.slice("/rules".length).trim().toLowerCase();
    if (action === "create") return { handled: true, openCreateRule: true };
    if (action && action !== "list") {
      return { handled: true, assistantMessage: "Usage: `/rules [list|create]`" };
    }
    const cwd = options.workspace?.cwd ?? process.cwd();
    return { handled: true, assistantMessage: await describeGuides(cwd, "rule") };
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
    return handleToolboxCommand(trimmed, "/toolbox");
  }

  if (trimmed === "/skills") {
    return { handled: true, openSkillPicker: true };
  }

  if (trimmed.startsWith("/skills ")) {
    return handleToolboxCommand(`/toolbox${trimmed.slice("/skills".length)}`, "/skills");
  }

  if (trimmed === "/plugins" || trimmed.startsWith("/plugins ")) {
    return handlePluginsCommand(trimmed, options);
  }

  if (trimmed === "/creative") {
    return handleCreativeCommand(options);
  }

  if (trimmed === "/web") {
    return handleWebCommand(options);
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

  if (trimmed === "/trace" || trimmed.startsWith("/trace ")) {
    return handleTraceCommand(trimmed, options);
  }

  if (trimmed === "/radar") {
    return {
      handled: true,
      assistantMessage: await formatRadarForOptions(options),
    };
  }

  if (trimmed === "/handoff") {
    return {
      handled: true,
      assistantMessage: await buildQuickHandoff({
        cwd: options.workspace?.cwd ?? process.cwd(),
        workspace: options.workspace,
      }),
    };
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

async function handleTraceCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const action = trimmed.slice("/trace".length).trim().toLowerCase();

  try {
    if (!action || action === "last") {
      return { handled: true, assistantMessage: await describeLatestTrace(cwd) };
    }

    if (action === "export") {
      const tracePath = await latestTraceExportPath(cwd);
      return {
        handled: true,
        assistantMessage: tracePath
          ? `Latest trace is already exported at \`${tracePath}\`.`
          : "No trace exists yet. Complete a model turn first.",
      };
    }

    return { handled: true, assistantMessage: "Usage: `/trace [last|export]`" };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Trace failed: ${e.message}` };
  }
}

function handleDailyTaskCommand(trimmed: string): LocalCommandResult {
  const rest = trimmed.slice("/task".length).trim();
  const [action, ...args] = rest.split(/\s+/).filter(Boolean);

  try {
    if (!action || action === "status" || action === "list") {
      return { handled: true, assistantMessage: describeDailyBoard() };
    }

    if (action === "add" || action === "remember" || action === "remind") {
      const text = args.join(" ").trim();
      if (!text) return { handled: true, assistantMessage: "Usage: `/task add <text>`" };
      const task = addDailyTask(text);
      return {
        handled: true,
        dailyBoardChanged: true,
        assistantMessage: `Added Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`,
      };
    }

    if (action === "done" || action === "complete" || action === "finish") {
      const id = Number.parseInt(args[0] ?? "", 10);
      if (!Number.isInteger(id) || id <= 0) return { handled: true, assistantMessage: "Usage: `/task done <id>`" };
      const task = completeDailyTask(id);
      if (!task) return { handled: true, assistantMessage: `I don't see task **${id}** on today's board.` };
      return {
        handled: true,
        dailyBoardChanged: true,
        assistantMessage: `Completed Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`,
      };
    }

    if (action === "clear" || action === "reset") {
      const count = clearDailyBoard();
      return {
        handled: true,
        dailyBoardChanged: true,
        assistantMessage: `Cleared ${count} Daily Board task${count === 1 ? "" : "s"}.`,
      };
    }

    return { handled: true, assistantMessage: "Usage: `/task [add <text>|done <id>|clear]`" };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Daily Board: ${e.message}` };
  }
}

async function handleKnowledgeCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const action = trimmed.slice("/index".length).trim().toLowerCase();

  try {
    if (action === "refresh" || action === "rebuild") {
      const index = await refreshKnowledgeIndex(cwd);
      return {
        handled: true,
        assistantMessage: `Workspace knowledge refreshed.\n\nFiles: \`${index.fileCount}\`\nChunks: \`${index.chunkCount}\``,
      };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/index [status|refresh]`" };
    }

    return { handled: true, assistantMessage: await describeKnowledgeIndex(cwd) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Workspace knowledge failed: ${e.message}` };
  }
}

async function handleKnowledgeSearchCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const query = trimmed.slice("/search".length).trim();
  if (!query) {
    return { handled: true, assistantMessage: "Usage: `/search <workspace knowledge query>`" };
  }

  try {
    const hits = await searchKnowledgeIndex(query, cwd, 8);
    return {
      handled: true,
      assistantMessage: `**Workspace Knowledge Search**\n\n${formatKnowledgeSearchResults(hits)}`,
    };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Workspace search failed: ${e.message}` };
  }
}

async function handleWorkspaceCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const alias = trimmed.startsWith("/workspaces") ? "/workspaces" : "/workspace";
  const parts = trimmed.slice(alias.length).trim().split(/\s+/).filter(Boolean);
  const action = parts[0] ?? "status";

  try {
    if (action === "status") {
      const context = formatWorkspaceContext(options.workspace) ?? "No workspace snapshot loaded.";
      return {
        handled: true,
        assistantMessage: `**Workspace**\n\n\`\`\`\n${context}\n\`\`\`\n\nUse \`/workspace list\`, \`/workspace add <path>\`, or \`/workspace hop <name>\`.`,
      };
    }

    if (action === "list") {
      const locations = await listTravelLocations();
      const current = options.workspace?.cwd ?? process.cwd();
      const lines = locations.slice(0, 50).map((loc) => {
        const active = loc.absPath === current ? "*" : " ";
        const git = loc.isGit ? "git" : "dir";
        return `${active} ${loc.label} [${loc.source}/${git}]\n  ${loc.absPath}`;
      });
      return {
        handled: true,
        assistantMessage: lines.length
          ? `**Known Workspaces**\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``
          : "No known workspaces. Use `/workspace add <path>` or enable auto_discover in `~/.switchbay/config.json`.",
      };
    }

    if (action === "add") {
      const location = parts.slice(1).join(" ").trim();
      if (!location) return { handled: true, assistantMessage: "Usage: `/workspace add <path>`" };
      addWhitelistedLocation(location);
      const added = resolveLocationInput(location);
      return { handled: true, assistantMessage: `Added workspace location:\n\n\`${added}\`\n\nUse \`/workspace hop ${added}\` to switch.` };
    }

    if (action === "hop" || action === "open" || action === "switch") {
      const query = stripWrappingQuotes(parts.slice(1).join(" ").trim());
      if (!query) return { handled: true, assistantMessage: "Usage: `/workspace hop <name-or-path>`" };
      const matches = await fuzzyMatchLocations(query);
      if (!matches.length) {
        return { handled: true, assistantMessage: `No workspace matched \`${query}\`. Use \`/workspace list\` or \`/workspace add <path>\`.` };
      }
      const target = matches[0]!;
      const result = await travelTo(target.absPath);
      if (!result.ok || !result.workspace) {
        return { handled: true, assistantMessage: `Workspace hop failed: ${result.error ?? "workspace snapshot failed"}` };
      }
      return {
        handled: true,
        travel: { toPath: target.absPath, label: target.label, workspace: result.workspace },
        assistantMessage: `Hopped to **${target.label}**\n\n\`${target.absPath}\``,
      };
    }

    return { handled: true, assistantMessage: "Usage: `/workspace [status|list|add <path>|hop <name>]`" };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Workspace command failed: ${e.message}` };
  }
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseConversationalWorkspaceHopIntent(input: string): { query: string; followUp?: string } | null {
  const normalized = input
    .replace(/^[,\s]*(hey|yo|ok|okay)?\s*(bay|switchbay)[,\s:;-]*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  const { primary, followUp } = splitFollowUpIntent(normalized);

  const patterns = [
    /^(?:please\s+)?(?:hop|switch|jump|travel|cd)(?:\s+(?:to|into|over\s+to))?\s+(?:the\s+)?(?:(?:workspace|repo|repository|project)\s+)?(.+)$/i,
    /^(?:please\s+)?(?:go\s+to|take\s+me\s+to|open)\s+(?:the\s+)?(?:workspace|repo|repository|project)\s+(.+)$/i,
    /^(?:please\s+)?(?:go\s+to|take\s+me\s+to|open)\s+(.+?)\s+(?:workspace|repo|repository|project)$/i,
  ];

  for (const pattern of patterns) {
    const query = primary.match(pattern)?.[1]?.trim();
    if (query) {
      return {
        query: cleanupWorkspaceQuery(query),
        ...(followUp ? { followUp } : {}),
      };
    }
  }

  return null;
}

function parseConversationalWorkspaceReferenceIntent(input: string): { query: string; followUp: string } | null {
  const normalized = input
    .replace(/^[,\s]*(hey|yo|ok|okay)?\s*(bay|switchbay)[,\s:;-]*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  if (!/\b(repo|repository|workspace|project|git|status|dirty|changed|changes)\b/i.test(normalized)) {
    return null;
  }

  const patterns = [
    /^(.+?)(?:[.;,]\s*)?\b(?:from|in|for)\s+["']([^"']+)["']$/i,
    /^(.+?)(?:[.;,]\s*)?\b(?:from|in|for)\s+(.+?)$/i,
    /^(?:repo|repository|workspace|project)\s+status\s+(?:from|in|for)\s+(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const request = (match.length >= 3 ? match[1] : "status")?.trim() || "status";
    const rawQuery = match.length >= 3 ? match[2] : match[1];
    const query = cleanupWorkspaceQuery(rawQuery ?? "");
    if (!looksLikeWorkspaceReference(rawQuery ?? "", query)) continue;
    if (!query || query.toLowerCase() === "scratch") continue;

    return {
      query,
      followUp: normalizeWorkspaceReferenceFollowUp(request),
    };
  }

  return null;
}

function looksLikeWorkspaceReference(rawQuery: string, query: string): boolean {
  const raw = rawQuery.trim();
  const lower = query.toLowerCase();
  if (!query) return false;
  if (["git", "repo", "repository", "workspace", "project", "status", "scratch"].includes(lower)) return false;
  if (/^(?:the\s+)?(?:repo|repository|workspace|project)\b/i.test(raw)) return false;
  if (/^(repo|repository|workspace|project)\s+/i.test(raw)) return false;
  if (/[?]/.test(raw)) return false;
  if (/\b(?:what|which|dirty|changed|changes|status)\b/i.test(raw) && !raw.startsWith(`"`) && !raw.startsWith(`'`)) return false;
  return raw.startsWith(`"`) ||
    raw.startsWith(`'`) ||
    raw.includes("/") ||
    /[A-Z]/.test(query) ||
    /[-_]/.test(query);
}

function splitFollowUpIntent(input: string): { primary: string; followUp?: string } {
  const match = input.match(/\s*(?:,|;)?\s+(?:and\s+)?then\s+(.+)$/i);
  if (!match?.index || !match[1]?.trim()) return { primary: input };
  return {
    primary: input.slice(0, match.index).replace(/[.!?;,]+$/g, "").trim(),
    followUp: normalizeFollowUpInput(match[1].trim()),
  };
}

function cleanupWorkspaceQuery(query: string): string {
  return stripWrappingQuotes(
    query
      .replace(/\s+(?:workspace|repo|repository|project)$/i, "")
      .replace(/[.!?;,]+$/g, "")
      .trim(),
  );
}

function normalizeFollowUpInput(input: string): string {
  const normalized = input.trim();
  if (/^(?:tell me|show me|give me)\s+(?:the\s+)?status(?:\s+of\s+the\s+(?:repo|repository|project|workspace))?$/i.test(normalized)) {
    return "Bay, what's changed in git?";
  }
  if (/^status(?:\s+of\s+the\s+(?:repo|repository|project|workspace))?$/i.test(normalized)) {
    return "Bay, what's changed in git?";
  }
  return normalized;
}

function normalizeWorkspaceReferenceFollowUp(input: string): string {
  const normalized = input.trim();
  if (/\b(status|dirty|changed|changes|git)\b/i.test(normalized)) {
    return "Bay, what's changed in git?";
  }
  return normalized;
}

async function handleConversationalOperatorIntent(
  input: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const normalized = normalizeBayTalk(input);

  const coached = matchCommandCoachIntent(normalized);
  if (coached) {
    return { handled: true, assistantMessage: localFirstMessage(coached) };
  }

  if (isAgendaQuestion(normalized)) {
    return { handled: true, assistantMessage: localFirstMessage(describeDailyBoard()) };
  }

  const reminder = parseReminderIntent(normalized);
  if (reminder) {
    try {
      const task = addDailyTask(reminder);
      return {
        handled: true,
        dailyBoardChanged: true,
        assistantMessage: localFirstMessage(`Added Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`),
      };
    } catch (e: any) {
      return { handled: true, assistantMessage: localFirstMessage(`Daily Board: ${e.message}`) };
    }
  }

  const doneId = parseTaskDoneIntent(normalized);
  if (doneId) {
    try {
      const task = completeDailyTask(doneId);
      if (!task) {
        return { handled: true, assistantMessage: localFirstMessage(`I don't see task **${doneId}** on today's board.`) };
      }
      return {
        handled: true,
        dailyBoardChanged: true,
        assistantMessage: localFirstMessage(`Completed Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`),
      };
    } catch (e: any) {
      return { handled: true, assistantMessage: localFirstMessage(`Daily Board: ${e.message}`) };
    }
  }

  if (isLaneQuestion(normalized)) {
    return { handled: true, assistantMessage: localFirstMessage(describeRuntimeStatus(options)) };
  }

  if (isMcpQuestion(normalized)) {
    const cwd = options.workspace?.cwd ?? process.cwd();
    return { handled: true, assistantMessage: localFirstMessage(describeLmStudioMcpConfig(await loadLmStudioMcpConfig(cwd))) };
  }

  if (isGitQuestion(normalized)) {
    return { handled: true, assistantMessage: localFirstMessage(describeGitState(options.workspace)) };
  }

  if (isWorkspaceQuestion(normalized)) {
    const context = formatWorkspaceContext(options.workspace) ?? "No workspace snapshot loaded.";
    return { handled: true, assistantMessage: localFirstMessage(`**Workspace**\n\n\`\`\`\n${context}\n\`\`\``) };
  }

  if (isRadarRequest(normalized)) {
    return { handled: true, assistantMessage: localFirstMessage(await formatRadarForOptions(options)) };
  }

  if (isHandoffRequest(normalized)) {
    return {
      handled: true,
      assistantMessage: localFirstMessage(await buildQuickHandoff({
        cwd: options.workspace?.cwd ?? process.cwd(),
        workspace: options.workspace,
      })),
    };
  }

  return { handled: false };
}

async function formatRadarForOptions(options: LocalCommandOptions): Promise<string> {
  const signals = await runFrictionRadar({
    cwd: options.workspace?.cwd ?? process.cwd(),
    runtimeLane: options.runtimeLane,
    toolMode: options.toolMode,
    workspace: options.workspace,
  });
  return formatFrictionRadar(signals);
}

function normalizeBayTalk(input: string): string {
  return input
    .toLowerCase()
    .replace(/^[,\s]*(hey|yo|ok|okay|so)?\s*(bay|switchbay)[,\s:;-]*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function localFirstMessage(message: string): string {
  return `Local-first:\n\n${message}`;
}

type CommandCoachEntry = {
  patterns: RegExp[];
  title: string;
  slash?: string;
  cli?: string;
  note?: string;
};

const COMMAND_COACH: CommandCoachEntry[] = [
  {
    title: "Switch to Ollama",
    patterns: [/\bollama\b/, /\blocal provider\b.*\bollama\b/],
    slash: "/lane ollama",
    cli: "switchbay local-provider set ollama",
    note: "Use `/model ollama` to browse local Ollama models after switching.",
  },
  {
    title: "Switch to LM Studio",
    patterns: [/\blm\s*studio\b/, /\blmstudio\b/, /\blocal provider\b.*\blm\b/],
    slash: "/lane lmstudio",
    cli: "switchbay local-provider set lmstudio",
  },
  {
    title: "Switch cloud provider",
    patterns: [/\b(openai|anthropic|claude|gpt|google|gemini)\b.*\b(provider|lane|cloud)\b/, /\bcloud provider\b/],
    slash: "/lane openai, /lane anthropic, or /lane google",
    cli: "switchbay cloud-provider set auto|openai|anthropic|google",
  },
  {
    title: "Pick or list models",
    patterns: [/\b(model|models)\b.*\b(list|pick|select|switch|change|show)\b/, /\b(list|pick|select|switch|change|show)\b.*\b(model|models)\b/],
    slash: "/model",
    cli: "switchbay models --lane <cloud|local|ollama>",
    note: "Pin one with `switchbay model <lane> <model-id>`.",
  },
  {
    title: "Use the Daily Board",
    patterns: [/\b(agenda|daily board|today'?s? board|task|tasks|reminder|reminders)\b/],
    slash: "/agenda, /task add <text>, /task done <id>",
    cli: 'switchbay agenda && switchbay task add "test brew"',
  },
  {
    title: "Sync Engine Bay",
    patterns: [/\b(engine|engines|engine bay)\b.*\b(sync|pull|update|refresh)\b/, /\b(sync|pull|update|refresh)\b.*\b(engine|engines|engine bay)\b/],
    slash: "/engine-bay sync",
    cli: "switchbay engines sync",
  },
  {
    title: "Work with skills",
    patterns: [/\b(skill|skills|toolbox)\b.*\b(list|sync|read|show|use)\b/, /\b(list|sync|read|show|use)\b.*\b(skill|skills|toolbox)\b/],
    slash: "/skills",
    cli: "switchbay skills list",
    note: "Read one with `switchbay skills read <id>`.",
  },
  {
    title: "Work with plugins",
    patterns: [/\b(plugin|plugins)\b/],
    slash: "/plugins or /create-plugin",
    cli: "switchbay plugins list",
    note: "Inspect one with `switchbay plugins inspect <id>`.",
  },
  {
    title: "Use MCP",
    patterns: [/\bmcp\b.*\b(on|off|enable|disable|status|catalog|init|create|configure)\b/, /\b(enable|disable|status|catalog|init|create|configure)\b.*\bmcp\b/],
    slash: "/mcp on, /mcp off, /mcp catalog",
    cli: "switchbay mcp status",
  },
  {
    title: "Use Workspace Knowledge",
    patterns: [/\b(knowledge|index|search)\b.*\b(refresh|rebuild|search|status|find)\b/, /\b(refresh|rebuild|search|status|find)\b.*\b(knowledge|index)\b/],
    slash: "/index refresh or /search <query>",
    cli: 'switchbay knowledge refresh && switchbay knowledge search "approval gates"',
  },
  {
    title: "Use workspace memory",
    patterns: [/\b(memory|remember|memories)\b.*\b(add|save|list|refresh|facts|show)\b/, /\b(add|save|list|refresh|facts|show)\b.*\b(memory|memories)\b/],
    slash: "/remember <note> or /memory refresh",
    cli: 'switchbay memory add "use Bun for tests"',
  },
  {
    title: "Hop workspaces",
    patterns: [/\b(workspace|repo|project)\b.*\b(hop|switch|add|list|travel)\b/, /\b(hop|switch|add|list|travel)\b.*\b(workspace|repo|project)\b/],
    slash: "/workspace list, /workspace add <path>, /workspace hop <name>",
    cli: 'switchbay "query" --hop <name>',
  },
  {
    title: "Sessions and resume",
    patterns: [/\b(session|sessions|resume)\b/],
    slash: "/sessions or /resume",
    cli: "switchbay --resume",
  },
  {
    title: "Trace the latest turn",
    patterns: [/\b(trace|receipt|latest turn)\b/],
    slash: "/trace or /trace export",
    cli: "switchbay trace",
  },
  {
    title: "Run Friction Radar",
    patterns: [/\b(radar|blockers?|friction|preflight)\b/],
    slash: "/radar",
    cli: "switchbay radar",
    note: "Radar is read-only and checks local release friction.",
  },
  {
    title: "Write a Quick Handoff",
    patterns: [/\b(handoff|hand off|handover|wrap|next time)\b/],
    slash: "/handoff",
    cli: "switchbay handoff",
  },
];

function matchCommandCoachIntent(normalized: string): string | null {
  if (!/\b(how do i|how can i|what command|which command|show me the command|what's the command|help me)\b/.test(normalized)) {
    return null;
  }

  const entry = COMMAND_COACH.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(normalized))
  );
  if (!entry) return null;

  return [
    `**Command Coach: ${entry.title}**`,
    "",
    entry.slash ? `TUI: \`${entry.slash}\`` : null,
    entry.cli ? `CLI: \`${entry.cli}\`` : null,
    entry.note ?? null,
  ].filter(Boolean).join("\n");
}

function isAgendaQuestion(normalized: string): boolean {
  if (/^(mark|complete|finish|done|add|remind)\b/.test(normalized)) return false;
  return /\b(agenda|today'?s?\s+board|daily\s+board|tasks?|reminders?|on deck)\b/.test(normalized) &&
    /\b(what|show|list|view|give|tell|agenda|tasks?|reminders?|on deck)\b/.test(normalized);
}

function parseReminderIntent(normalized: string): string | null {
  const match = normalized.match(/^(?:please\s+)?(?:remind me to|add(?: a)? task(?: to)?|task add|put(?: this)? on(?: my| the)?(?: agenda| board)?|add(?: this)? to(?: my| the)?(?: agenda| board))\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseTaskDoneIntent(normalized: string): number | null {
  const match = normalized.match(/^(?:mark|complete|finish|done)(?: task)?\s+(\d+)(?:\s+(?:done|complete|finished))?$/i) ??
    normalized.match(/^task\s+(\d+)\s+(?:done|complete|finished)$/i);
  const id = Number.parseInt(match?.[1] ?? "", 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isLaneQuestion(normalized: string): boolean {
  return /\b(lane|model|provider|runtime)\b/.test(normalized) &&
    /\b(what|which|show|current|using|active|status)\b/.test(normalized);
}

function isMcpQuestion(normalized: string): boolean {
  return /\bmcp\b/.test(normalized) &&
    /\b(what|show|status|configured|config|on|enabled|active)\b/.test(normalized);
}

function isWorkspaceQuestion(normalized: string): boolean {
  return /\b(workspace|repo|repository|project|cwd|where am i)\b/.test(normalized) &&
    /\b(what|which|show|current|where|status)\b/.test(normalized);
}

function isGitQuestion(normalized: string): boolean {
  return /\b(git|changed|changes|dirty|branch|status|working tree)\b/.test(normalized) &&
    /\b(what|show|status|changed|changes|dirty|branch)\b/.test(normalized);
}

function isRadarRequest(normalized: string): boolean {
  return /\b(radar|blockers?|friction|release blockers?|preflight)\b/.test(normalized) &&
    /\b(run|check|show|scan|what|any|status)\b/.test(normalized);
}

function isHandoffRequest(normalized: string): boolean {
  return /\b(handoff|hand off|handover|wrap|summary for next time|next time)\b/.test(normalized) &&
    /\b(write|make|create|give|show|summari[sz]e|draft)\b/.test(normalized);
}

function describeRuntimeStatus(options: LocalCommandOptions): string {
  const lane = options.runtimeLane ?? getRuntimeLane();
  const toolMode = options.toolMode ?? getToolMode();
  const selected = getSelectedRuntimeModel(lane);
  const lines = [
    "**Runtime**",
    "",
    `Lane: ${getRuntimeLaneLabel(lane)}`,
    `Tool mode: ${toolMode}`,
    lane === "local" ? `Local provider: ${getActiveLocalProvider()}` : null,
    lane === "cloud" || lane === "cloud-mcp" ? `Cloud provider: ${getActiveCloudProvider()}` : null,
    `Model: ${selected?.id ?? "default"}`,
    "",
    "Switch with `/lane`, `/lane openai`, `/lane anthropic`, `/lane google`, `/lane ollama`, or `/model`.",
  ];
  return lines.filter(Boolean).join("\n");
}

function describeGitState(workspace: WorkspaceSnapshot | null): string {
  if (!workspace) return "No workspace snapshot loaded.";
  const dirty = workspace.dirtyFiles.length
    ? workspace.dirtyFiles.slice(0, 12).map((file) => `- ${file}`).join("\n")
    : "clean working tree";
  return [
    "**Git State**",
    "",
    `Branch: ${workspace.branch ?? "unknown"}`,
    `Dirty files: ${workspace.dirtyFiles.length}`,
    "",
    dirty,
  ].join("\n");
}

function parseConversationalCreationIntent(input: string): "agent" | "engine" | "mcp" | "rule" | "skill" | "plugin" | null {
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
  if (/\b(rule|rules|operating rule|behavior rule|always remember to|never do|must always|must never)\b/.test(normalized)) return "rule";
  if (/\b(plugin|plugins|bundle|crate|pack)\b/.test(normalized)) return "plugin";
  if (/\b(skill|toolbox skill|workflow|checklist)\b/.test(normalized)) return "skill";
  return null;
}

async function handlePluginsCommand(
  trimmed: string,
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const args = trimmed.slice("/plugins".length).trim();
  const [action, ...rest] = args.split(/\s+/).filter(Boolean);

  try {
    if (action === "create") return { handled: true, openCreatePlugin: true };
    if (action === "inspect") {
      const id = rest.join(" ");
      if (!id) return { handled: true, assistantMessage: "Usage: `/plugins inspect <id>`" };
      const plugin = await readPlugin(id, cwd);
      if (!plugin) return { handled: true, assistantMessage: `No plugin found for \`${id}\`.` };
      return {
        handled: true,
        assistantMessage: `**${plugin.manifest.name}** (${plugin.manifest.id})\n\n\`\`\`json\n${JSON.stringify(plugin.manifest, null, 2)}\n\`\`\``,
      };
    }
    if (action && action !== "list" && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/plugins [list|status|inspect <id>|create]`" };
    }
    return { handled: true, assistantMessage: await describePlugins(cwd) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Plugins failed: ${e.message}` };
  }
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
        assistantMessage: `Created Switchbay MCP config at \`${path}\`.\n\nEdit it to match trusted MCP intent, then enable the bridge with \`/mcp on\`. Use \`/lane native-mcp\` only when testing LM Studio's native MCP API.`,
      };
    }

    if (action === "create") {
      return { handled: true, openCreateMcp: true };
    }

    if (action === "catalog") {
      return {
        handled: true,
        assistantMessage: `**Trusted MCP Catalog**\n\n${describeTrustedMcpCatalog()}\n\nBay will only create MCP configs from this catalog. For anything else, verify the server first, then add the exact id manually.`,
      };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: "Usage: `/mcp [status|init|create|catalog|on|off]`" };
    }

    return { handled: true, assistantMessage: describeLmStudioMcpConfig(await loadLmStudioMcpConfig(cwd)) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `MCP config failed: ${e.message}` };
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

async function handleWebCommand(options: LocalCommandOptions): Promise<LocalCommandResult> {
  const cwd = options.workspace?.cwd ?? process.cwd();
  const registry = await loadEngineRegistry(cwd);
  const web = registry.engines.find((engine) => engine.id === "web");
  if (!web) {
    return { handled: true, assistantMessage: "Web Engine is not available in this workspace." };
  }

  const tools = web.tools
    .map((tool) => `- \`${tool.name}\` - ${tool.description}`)
    .join("\n");
  return {
    handled: true,
    assistantMessage: [
      "**Web Engine**",
      "",
      web.description,
      "",
      tools,
      "",
      "Guardrails:",
      "- explicit public `http`/`https` URLs only",
      "- localhost, LAN, link-local, and private IP hosts are blocked by default",
      "- fetched text is size-limited; Bay should cite URLs used for factual claims",
      "",
      "Use the `web-research` Skill for source-backed current-info work.",
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

async function handleToolboxCommand(trimmed: string, displayCommand = "/skills"): Promise<LocalCommandResult> {
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
          : `No skill templates found. Run \`${displayCommand} sync\`.`,
      };
    }

    if (action === "list") {
      return {
        handled: true,
        assistantMessage: inventory.skills.length
          ? inventory.skills.map((skill) => `- \`${skill.id}\` - **${skill.name}**: ${skill.description}`).join("\n")
          : "No skills found.",
      };
    }

    if (action === "read") {
      const skillId = parts[1];
      if (!skillId) return { handled: true, assistantMessage: `Usage: \`${displayCommand} read <skill-id>\`` };
      const skill = await readToolboxSkill(skillId);
      return {
        handled: true,
        assistantMessage: skill ? skill.body : `Skill not found: \`${skillId}\``,
      };
    }

    if (action && action !== "status") {
      return { handled: true, assistantMessage: `Usage: \`${displayCommand} [status|sync|list|templates|read <skill-id>]\`` };
    }

    return { handled: true, assistantMessage: await describeToolbox(false) };
  } catch (e: any) {
    return { handled: true, assistantMessage: `Skills failed: ${e.message}` };
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
