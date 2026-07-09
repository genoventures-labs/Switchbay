import { loadDailyBoard } from "./daily-board";
import { loadLatestTrace } from "../trace/store";
import { listSessions } from "../session/persistence";
import { runCommand } from "../tools/shell";
import type { WorkspaceSnapshot } from "../session/workspace";

export type HandoffOptions = {
  cwd?: string;
  workspace?: WorkspaceSnapshot | null;
};

export async function buildQuickHandoff(options: HandoffOptions = {}): Promise<string> {
  const cwd = options.cwd ?? options.workspace?.cwd ?? process.cwd();
  const [branch, dirtyFiles, latestTrace, sessions] = await Promise.all([
    readGitBranch(cwd, options.workspace),
    readGitDirtyFiles(cwd, options.workspace),
    loadLatestTrace(cwd),
    listSessions(),
  ]);
  const board = loadDailyBoard();
  const activeTasks = board.items.filter((item) => item.status === "active");
  const lastSession = sessions[0] ?? null;
  const changedFiles = latestTrace?.record.actions.changedFiles.length
    ? latestTrace.record.actions.changedFiles
    : dirtyFiles.map((line) => line.replace(/^..?\s+/, ""));

  const lines = [
    "**Quick Handoff**",
    "",
    `Workspace: \`${cwd}\`${branch ? ` on \`${branch}\`` : ""}`,
    `Last session: ${lastSession ? `${lastSession.title} (${new Date(lastSession.updatedAt).toLocaleString()})` : "none found"}`,
    `Latest objective: ${latestTrace?.record.objective ?? "none traced yet"}`,
    "",
    "Changed Files",
    changedFiles.length ? changedFiles.slice(0, 12).map((file) => `- \`${file}\``).join("\n") : "- none",
    "",
    "Tests / Trace",
    latestTrace
      ? [
          `- Tools: ${latestTrace.record.actions.toolCount}`,
          `- Failed tools: ${latestTrace.record.actions.tools.filter((tool) => !tool.ok).length}`,
          `- Pending approvals: ${latestTrace.record.actions.pendingApprovals.length}`,
          `- Trace: \`${latestTrace.path}\``,
        ].join("\n")
      : "- no trace yet",
    "",
    "Daily Board",
    activeTasks.length ? activeTasks.map((task) => `- ${task.id}. ${task.text}`).join("\n") : "- no active tasks",
    "",
    `Next: ${nextStep(activeTasks.length, dirtyFiles.length, latestTrace?.record.actions.tools.filter((tool) => !tool.ok).length ?? 0)}`,
  ];

  return lines.join("\n");
}

async function readGitBranch(cwd: string, workspace?: WorkspaceSnapshot | null): Promise<string | null> {
  if (workspace?.branch) return workspace.branch;
  const result = await runCommand(["git", "branch", "--show-current"], cwd);
  return result.ok && result.stdout ? result.stdout : null;
}

async function readGitDirtyFiles(cwd: string, workspace?: WorkspaceSnapshot | null): Promise<string[]> {
  if (workspace?.dirtyFiles) return workspace.dirtyFiles;
  const result = await runCommand(["git", "status", "--short"], cwd);
  if (!result.ok) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function nextStep(activeTasks: number, dirtyFiles: number, failedTools: number): string {
  if (failedTools > 0) return "inspect the latest trace with `switchbay trace`.";
  if (dirtyFiles > 0) return "review the working tree with `git status --short`.";
  if (activeTasks > 0) return "pick the first Daily Board item and keep moving.";
  return "choose the next 1.5 item or run a release smoke pass.";
}
