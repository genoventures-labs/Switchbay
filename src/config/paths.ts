import path from "node:path";
import { existsSync } from "node:fs";

export const APP_STORAGE_DIR = ".switchbay";
export const LEGACY_STORAGE_DIRS = [".harness", ".ori"] as const;
export const PROJECT_CONTEXT_FILE = "SWITCHBAY.md";
export const LEGACY_PROJECT_CONTEXT_FILES = ["HARNESS.md", "ORI.md"] as const;

export function workspaceStorageDir(cwd = process.cwd()): string {
  return path.join(cwd, APP_STORAGE_DIR);
}

export function legacyWorkspaceStorageDirs(cwd = process.cwd()): string[] {
  return LEGACY_STORAGE_DIRS.map((dir) => path.join(cwd, dir));
}

export function legacyWorkspaceStorageDir(cwd = process.cwd()): string {
  return legacyWorkspaceStorageDirs(cwd)[0] ?? path.join(cwd, ".harness");
}

export function projectContextPath(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_CONTEXT_FILE);
}

export function legacyProjectContextPaths(cwd = process.cwd()): string[] {
  return LEGACY_PROJECT_CONTEXT_FILES.map((file) => path.join(cwd, file));
}

export function legacyProjectContextPath(cwd = process.cwd()): string {
  return legacyProjectContextPaths(cwd)[0] ?? path.join(cwd, "HARNESS.md");
}

export function existingProjectContextPath(cwd = process.cwd()): string | null {
  const next = projectContextPath(cwd);
  if (existsSync(next)) return next;
  for (const legacy of legacyProjectContextPaths(cwd)) {
    if (existsSync(legacy)) return legacy;
  }
  return null;
}

export function workspaceDataPath(cwd: string, fileName: string): string {
  return path.join(workspaceStorageDir(cwd), fileName);
}

export function legacyWorkspaceDataPath(cwd: string, fileName: string): string {
  return path.join(legacyWorkspaceStorageDir(cwd), fileName);
}

export function existingWorkspaceDataPath(cwd: string, fileName: string): string {
  const next = workspaceDataPath(cwd, fileName);
  if (existsSync(next)) return next;
  for (const legacyDir of legacyWorkspaceStorageDirs(cwd)) {
    const legacy = path.join(legacyDir, fileName);
    if (existsSync(legacy)) return legacy;
  }
  return legacyWorkspaceDataPath(cwd, fileName);
}
