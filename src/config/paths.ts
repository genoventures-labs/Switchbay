import path from "node:path";
import { existsSync } from "node:fs";

export const APP_STORAGE_DIR = ".switchbay";
export const PROJECT_CONTEXT_FILE = "SWITCHBAY.md";

export function workspaceStorageDir(cwd = process.cwd()): string {
  return path.join(cwd, APP_STORAGE_DIR);
}

export function projectContextPath(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_CONTEXT_FILE);
}

export function existingProjectContextPath(cwd = process.cwd()): string | null {
  const next = projectContextPath(cwd);
  if (existsSync(next)) return next;
  return null;
}

export function workspaceDataPath(cwd: string, fileName: string): string {
  return path.join(workspaceStorageDir(cwd), fileName);
}

export function existingWorkspaceDataPath(cwd: string, fileName: string): string {
  const next = workspaceDataPath(cwd, fileName);
  if (existsSync(next)) return next;
  return next;
}
