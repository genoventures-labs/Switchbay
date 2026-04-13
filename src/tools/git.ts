import { runCommand } from "./shell";

export async function getGitStatusSummary(cwd = process.cwd()): Promise<string> {
  const [status, branch] = await Promise.all([
    runCommand(["git", "status", "--short"], cwd),
    runCommand(["git", "branch", "--show-current"], cwd),
  ]);

  return [
    `Branch: ${branch.ok ? branch.stdout || "unknown" : "unknown"}`,
    status.ok && status.stdout ? status.stdout : "Working tree clean.",
  ].join("\n");
}

export async function getRecentGitLog(cwd = process.cwd()): Promise<string> {
  const result = await runCommand(
    ["git", "log", "--oneline", "-5", "--decorate"],
    cwd,
  );

  return result.ok && result.stdout
    ? result.stdout
    : "No recent git log entries available.";
}
