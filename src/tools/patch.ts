import { runCommand } from "./shell";

export type DiffSummary = {
  hasChanges: boolean;
  stat: string;
};

export type PatchPreview = {
  targetPath: string;
  diff: string;
};

export async function getDiffSummary(cwd = process.cwd()): Promise<DiffSummary> {
  const result = await runCommand(["git", "diff", "--stat"], cwd);

  return {
    hasChanges: Boolean(result.stdout.trim()),
    stat: result.stdout.trim() || "No unstaged diff.",
  };
}

export async function buildPatchPreview(input: {
  before: string;
  after: string;
  cwd?: string;
  targetPath: string;
}): Promise<PatchPreview> {
  const cwd = input.cwd ?? process.cwd();
  const tempDir = await Bun.$`mktemp -d`.cwd(cwd).text();
  const trimmedTempDir = tempDir.trim();
  const beforePath = `${trimmedTempDir}/before.tmp`;
  const afterPath = `${trimmedTempDir}/after.tmp`;

  await Bun.write(beforePath, input.before);
  await Bun.write(afterPath, input.after);

  const result = await runCommand(
    ["git", "diff", "--no-index", "--", beforePath, afterPath],
    cwd,
  );

  const rewrittenDiff = (result.stdout || result.stderr || "No patch preview available.")
    .split("\n")
    .map((line) => {
      if (line.startsWith(`diff --git a${beforePath} b${afterPath}`) || line.startsWith(`diff --git a/${beforePath} b/${afterPath}`)) {
        return `diff --git a/${input.targetPath} b/${input.targetPath}`;
      }
      if (line.startsWith(`--- a${beforePath}`) || line.startsWith(`--- a/${beforePath}`)) {
        return `--- a/${input.targetPath}`;
      }
      if (line.startsWith(`+++ b${afterPath}`) || line.startsWith(`+++ b/${afterPath}`)) {
        return `+++ b/${input.targetPath}`;
      }
      return line
        .replaceAll(beforePath, input.targetPath)
        .replaceAll(afterPath, input.targetPath);
    })
    .join("\n");

  await Bun.$`rm -rf ${trimmedTempDir}`.cwd(cwd).quiet();

  return {
    targetPath: input.targetPath,
    diff: rewrittenDiff,
  };
}
