import path from "node:path";
import type { WorkspaceSnapshot } from "../session/workspace";
import type { DailyBoard } from "./daily-board";
import { DAILY_ACTIVE_LIMIT } from "./daily-board";

export type StartupOverviewSession = {
  id?: string;
  title: string;
  updatedAt: number;
};

export type StartupOverviewInput = {
  workspace: WorkspaceSnapshot | null;
  runtimeBadge: string;
  dailyBoard?: DailyBoard | null;
  sessions?: StartupOverviewSession[];
  now?: Date;
};

export function buildStartupOverview(input: StartupOverviewInput): string {
  const now = input.now ?? new Date();
  const activeTasks = input.dailyBoard?.items.filter((item) => item.status === "active") ?? [];
  const latestSession = input.sessions?.[0] ?? null;
  const workspaceName = input.workspace
    ? path.basename(input.workspace.repoRoot ?? input.workspace.cwd) || input.workspace.cwd
    : "unknown workspace";
  const branch = input.workspace?.branch ? ` on ${input.workspace.branch}` : "";
  const dirty = input.workspace?.dirtyFiles.length ?? 0;
  const dirtyText = dirty ? `${dirty} dirty` : "clean";
  const nextTask = activeTasks[0]?.text;
  const last = latestSession?.title && latestSession.title !== "Untitled Session"
    ? latestSession.title
    : null;

  return [
    `${timeGreeting(now)}. It's ${formatOverviewDate(now)}.`,
    "",
    input.dailyBoard ? `Today: ${activeTasks.length}/${DAILY_ACTIVE_LIMIT} open${nextTask ? ` · next: ${nextTask}` : ""}` : null,
    `Workspace: ${workspaceName}${branch} · ${dirtyText}`,
    `Lane: ${input.runtimeBadge}`,
    last ? `Last: ${last}` : null,
    input.dailyBoard
      ? nextTask ? "Try `/agenda` when you want the full board." : "Add a task with `/task add <text>` when something needs to stay visible."
      : null,
  ].filter(Boolean).join("\n");
}

function timeGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Late night board check";
}

function formatOverviewDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}
