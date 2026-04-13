import { listProjectFiles } from "../tools/files";
import type { DiffSummary } from "../tools/patch";
import { getDiffSummary } from "../tools/patch";
import { runCommand } from "../tools/shell";

export type WorkspaceSnapshot = {
  cwd: string;
  repoRoot: string | null;
  branch: string | null;
  dirtyFiles: string[];
  recentFiles: string[];
  diff: DiffSummary | null;
};

export async function loadWorkspaceSnapshot(
  cwd = process.cwd(),
): Promise<WorkspaceSnapshot> {
  const [repoRootResult, branchResult, statusResult, recentFiles, diff] =
    await Promise.all([
      runCommand(["git", "rev-parse", "--show-toplevel"], cwd),
      runCommand(["git", "branch", "--show-current"], cwd),
      runCommand(["git", "status", "--short"], cwd),
      listProjectFiles(cwd),
      getDiffSummary(cwd),
    ]);

  const dirtyFiles = statusResult.ok
    ? statusResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  return {
    cwd,
    repoRoot: repoRootResult.ok ? repoRootResult.stdout || cwd : null,
    branch: branchResult.ok ? branchResult.stdout || null : null,
    dirtyFiles,
    recentFiles,
    diff,
  };
}

export function formatWorkspaceContext(snapshot: WorkspaceSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }

  const dirtySummary =
    snapshot.dirtyFiles.length > 0
      ? snapshot.dirtyFiles.slice(0, 8).join(", ")
      : "clean working tree";

  const recentFiles =
    snapshot.recentFiles.length > 0
      ? snapshot.recentFiles.slice(0, 8).join(", ")
      : "no indexed files";

  return [
    `Workspace cwd: ${snapshot.cwd}`,
    `Repo root: ${snapshot.repoRoot ?? "unknown"}`,
    `Branch: ${snapshot.branch ?? "unknown"}`,
    `Dirty files: ${dirtySummary}`,
    `Recent files: ${recentFiles}`,
  ].join("\n");
}
