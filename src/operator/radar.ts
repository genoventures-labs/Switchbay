import { getRuntimeLane, getToolMode, type RuntimeLane, type ToolMode } from "../config/env";
import { getActiveCloudProvider, hasCloudProviderKey } from "../runtime/cloud-providers";
import { getActiveLocalProvider, getLocalProviderConfig } from "../runtime/local-providers";
import { loadLmStudioMcpConfig } from "../runtime/lmstudio-mcp-config";
import { loadLatestTrace } from "../trace/store";
import { loadDailyBoard, DAILY_ACTIVE_LIMIT } from "./daily-board";
import { runCommand } from "../tools/shell";
import type { WorkspaceSnapshot } from "../session/workspace";

export type RadarSeverity = "blocker" | "warning" | "clean";

export type RadarSignal = {
  severity: RadarSeverity;
  title: string;
  detail: string;
  next?: string;
};

export type RadarOptions = {
  cwd?: string;
  runtimeLane?: RuntimeLane;
  toolMode?: ToolMode;
  workspace?: WorkspaceSnapshot | null;
};

export async function runFrictionRadar(options: RadarOptions = {}): Promise<RadarSignal[]> {
  const cwd = options.cwd ?? options.workspace?.cwd ?? process.cwd();
  const lane = options.runtimeLane ?? getRuntimeLane();
  const toolMode = options.toolMode ?? getToolMode();

  const signals: RadarSignal[] = [
    await gitSignal(cwd, options.workspace),
    cloudKeySignal(lane),
    await localProviderSignal(lane),
    await mcpSignal(cwd, lane, toolMode),
    await latestTraceSignal(cwd),
    dailyBoardSignal(),
  ];

  return signals;
}

export function formatFrictionRadar(signals: RadarSignal[]): string {
  const blockers = signals.filter((signal) => signal.severity === "blocker");
  const warnings = signals.filter((signal) => signal.severity === "warning");
  const clean = signals.filter((signal) => signal.severity === "clean");

  const lines = [
    "**Friction Radar**",
    "",
    `Blockers: ${blockers.length}`,
    `Warnings: ${warnings.length}`,
    `Clean: ${clean.length}`,
  ];

  appendSignals(lines, "Blockers", blockers);
  appendSignals(lines, "Warnings", warnings);
  appendSignals(lines, "Clean Signals", clean);

  const next = blockers[0]?.next ?? warnings[0]?.next;
  if (next) {
    lines.push("", `Next: \`${next}\``);
  }

  return lines.join("\n");
}

async function gitSignal(cwd: string, workspace?: WorkspaceSnapshot | null): Promise<RadarSignal> {
  const dirtyFiles = workspace?.dirtyFiles ?? await readGitDirtyFiles(cwd);
  if (dirtyFiles.length > 0) {
    return {
      severity: "warning",
      title: "Dirty git tree",
      detail: `${dirtyFiles.length} changed file${dirtyFiles.length === 1 ? "" : "s"}.`,
      next: "git status --short",
    };
  }

  return {
    severity: "clean",
    title: "Git tree",
    detail: "No uncommitted changes detected.",
  };
}

function cloudKeySignal(lane: RuntimeLane): RadarSignal {
  if (lane !== "cloud" && lane !== "cloud-mcp") {
    return {
      severity: "clean",
      title: "Cloud keys",
      detail: "Cloud lane is not active.",
    };
  }

  const provider = getActiveCloudProvider();
  if (provider !== "auto") {
    return hasCloudProviderKey(provider)
      ? { severity: "clean", title: "Cloud key", detail: `${provider} key is configured.` }
      : {
          severity: "blocker",
          title: "Missing cloud key",
          detail: `${provider} is selected but its API key is not set.`,
          next: `switchbay cloud-provider set auto`,
        };
  }

  const configured = ["openai", "anthropic", "google"].filter((id) =>
    hasCloudProviderKey(id as "openai" | "anthropic" | "google")
  );
  if (!configured.length) {
    return {
      severity: "blocker",
      title: "Missing cloud keys",
      detail: "Cloud auto routing needs at least one cloud API key.",
      next: "switchbay cloud-provider",
    };
  }

  return {
    severity: "clean",
    title: "Cloud router",
    detail: `Configured providers: ${configured.join(", ")}.`,
  };
}

async function localProviderSignal(lane: RuntimeLane): Promise<RadarSignal> {
  if (lane !== "local" && lane !== "local-mcp") {
    return {
      severity: "clean",
      title: "Local provider",
      detail: "Local lane is not active.",
    };
  }

  const provider = lane === "local-mcp" ? "lmstudio" : getActiveLocalProvider();
  const config = getLocalProviderConfig(provider);
  const url = provider === "ollama" ? `${config.apiBase}/tags` : `${config.apiBase}/models`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) {
      return {
        severity: "warning",
        title: "Local provider reachable with error",
        detail: `${config.label} answered ${response.status}.`,
        next: "switchbay models --lane local",
      };
    }
    return {
      severity: "clean",
      title: "Local provider",
      detail: `${config.label} is reachable.`,
    };
  } catch (error: any) {
    return {
      severity: "blocker",
      title: "Local provider unreachable",
      detail: `Could not reach ${config.label} at ${url}: ${error.message}`,
      next: provider === "ollama" ? "switchbay local-provider set lmstudio" : "switchbay local-provider set ollama",
    };
  }
}

async function mcpSignal(cwd: string, lane: RuntimeLane, toolMode: ToolMode): Promise<RadarSignal> {
  const usesSwitchbayMcp = toolMode === "switchbay-mcp" || lane === "cloud-mcp";
  if (!usesSwitchbayMcp && lane !== "local-mcp") {
    return {
      severity: "clean",
      title: "MCP",
      detail: "MCP bridge is not active.",
    };
  }

  const status = await loadLmStudioMcpConfig(cwd);
  if (!status.exists) {
    return {
      severity: "warning",
      title: "MCP config missing",
      detail: `No MCP config exists at ${status.path}.`,
      next: "switchbay mcp init",
    };
  }

  if (!status.integrations.length) {
    return {
      severity: "warning",
      title: "MCP has no integrations",
      detail: "MCP config exists, but no integrations are configured.",
      next: "switchbay mcp catalog",
    };
  }

  return {
    severity: "clean",
    title: "MCP",
    detail: `${status.integrations.length} integration${status.integrations.length === 1 ? "" : "s"} configured.`,
  };
}

async function latestTraceSignal(cwd: string): Promise<RadarSignal> {
  const latest = await loadLatestTrace(cwd);
  if (!latest) {
    return {
      severity: "warning",
      title: "Trace ledger",
      detail: "No completed model turn trace found yet.",
      next: "switchbay trace",
    };
  }

  const failedTools = latest.record.actions.tools.filter((tool) => !tool.ok);
  if (failedTools.length > 0) {
    return {
      severity: "warning",
      title: "Latest trace has failed tools",
      detail: `${failedTools.length} failed tool step${failedTools.length === 1 ? "" : "s"} in the latest turn.`,
      next: "switchbay trace",
    };
  }

  if (latest.record.actions.pendingApprovals.length > 0) {
    return {
      severity: "warning",
      title: "Latest trace has pending approvals",
      detail: `${latest.record.actions.pendingApprovals.length} approval${latest.record.actions.pendingApprovals.length === 1 ? "" : "s"} left pending.`,
      next: "switchbay trace",
    };
  }

  return {
    severity: "clean",
    title: "Latest trace",
    detail: "No failed tool steps or pending approvals in the latest trace.",
  };
}

function dailyBoardSignal(): RadarSignal {
  const board = loadDailyBoard();
  const active = board.items.filter((item) => item.status === "active").length;
  if (active >= DAILY_ACTIVE_LIMIT) {
    return {
      severity: "warning",
      title: "Daily Board full",
      detail: `${active}/${DAILY_ACTIVE_LIMIT} active items.`,
      next: "switchbay task done <id>",
    };
  }

  return {
    severity: "clean",
    title: "Daily Board",
    detail: `${active}/${DAILY_ACTIVE_LIMIT} active items.`,
  };
}

async function readGitDirtyFiles(cwd: string): Promise<string[]> {
  const result = await runCommand(["git", "status", "--short"], cwd);
  if (!result.ok) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function appendSignals(lines: string[], title: string, signals: RadarSignal[]): void {
  if (!signals.length) return;
  lines.push("", title);
  for (const signal of signals) {
    lines.push(`- ${signal.title}: ${signal.detail}`);
  }
}
