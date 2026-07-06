import path from "node:path";
import { existsSync } from "node:fs";

export const APP_STORAGE_DIR = ".harness";
export const LEGACY_STORAGE_DIR = ".ori";
export const PROJECT_CONTEXT_FILE = "HARNESS.md";
export const LEGACY_PROJECT_CONTEXT_FILE = "ORI.md";

export function workspaceStorageDir(cwd = process.cwd()): string {
  return path.join(cwd, APP_STORAGE_DIR);
}

export function legacyWorkspaceStorageDir(cwd = process.cwd()): string {
  return path.join(cwd, LEGACY_STORAGE_DIR);
}

export function projectContextPath(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_CONTEXT_FILE);
}

export function legacyProjectContextPath(cwd = process.cwd()): string {
  return path.join(cwd, LEGACY_PROJECT_CONTEXT_FILE);
}

export function existingProjectContextPath(cwd = process.cwd()): string | null {
  const next = projectContextPath(cwd);
  if (existsSync(next)) return next;
  const legacy = legacyProjectContextPath(cwd);
  if (existsSync(legacy)) return legacy;
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
  return legacyWorkspaceDataPath(cwd, fileName);
}
