import path from "node:path";
import { runCommand } from "./shell";

function resolveWorkspacePath(targetPath: string, cwd = process.cwd()): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
}

export async function listProjectFiles(
  cwd = process.cwd(),
  limit = 12,
): Promise<string[]> {
  const result = await runCommand(["rg", "--files"], cwd);

  if (!result.ok) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function readProjectFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readWorkspaceFile(
  targetPath: string,
  cwd = process.cwd(),
): Promise<{ absolutePath: string; content: string }> {
  const absolutePath = resolveWorkspacePath(targetPath, cwd);
  return {
    absolutePath,
    content: await Bun.file(absolutePath).text(),
  };
}

export async function writeWorkspaceFile(
  targetPath: string,
  content: string,
  cwd = process.cwd(),
): Promise<{ absolutePath: string; content: string }> {
  const absolutePath = resolveWorkspacePath(targetPath, cwd);
  await Bun.$`mkdir -p ${path.dirname(absolutePath)}`.quiet();
  await Bun.write(absolutePath, content);

  return {
    absolutePath,
    content,
  };
}
