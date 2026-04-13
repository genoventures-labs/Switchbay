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
    .replaceAll(beforePath, `a/${input.targetPath}`)
    .replaceAll(afterPath, `b/${input.targetPath}`);

  await Bun.$`rm -rf ${trimmedTempDir}`.cwd(cwd).quiet();

  return {
    targetPath: input.targetPath,
    diff: rewrittenDiff,
  };
}
