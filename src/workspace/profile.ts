import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { workspaceDataPath } from "../config/paths";

export type WorkspaceProfile = {
  version: 1;
  name: string;
  purpose: string;
  stack: string[];
  packageManager: string | null;
  commands: Record<string, string>;
  importantPaths: string[];
  deployTarget: string | null;
  relatedWorkspaces: string[];
  priorities: string[];
  updatedAt: string;
};

export function workspaceProfilePath(cwd: string): string {
  return workspaceDataPath(cwd, "workspace.json");
}

export async function loadWorkspaceProfile(cwd: string): Promise<WorkspaceProfile | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(workspaceProfilePath(cwd), "utf-8")) as WorkspaceProfile;
    return parsed?.version === 1 ? parsed : null;
  } catch { return null; }
}

export async function refreshWorkspaceProfile(cwd: string): Promise<WorkspaceProfile> {
  const prior = await loadWorkspaceProfile(cwd);
  let pkg: any = {};
  try { pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf-8")); } catch {}
  const stack = detectStack(pkg, cwd);
  const importantPaths = (await fs.readdir(cwd, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .slice(0, 16)
    .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name);
  const generated: WorkspaceProfile = {
    version: 1,
    name: String(pkg.name || path.basename(cwd)),
    purpose: String(pkg.description || prior?.purpose || ""),
    stack,
    packageManager: existsSync(path.join(cwd, "bun.lock")) || existsSync(path.join(cwd, "bun.lockb")) ? "bun"
      : existsSync(path.join(cwd, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(path.join(cwd, "yarn.lock")) ? "yarn"
      : existsSync(path.join(cwd, "package-lock.json")) ? "npm" : prior?.packageManager ?? null,
    commands: Object.fromEntries(Object.entries(pkg.scripts ?? {}).map(([key, value]) => [key, String(value)])),
    importantPaths,
    deployTarget: prior?.deployTarget ?? null,
    relatedWorkspaces: prior?.relatedWorkspaces ?? [],
    priorities: prior?.priorities ?? [],
    updatedAt: new Date().toISOString(),
  };
  const profile = { ...generated, ...prior, stack: generated.stack, commands: generated.commands, importantPaths: generated.importantPaths, updatedAt: generated.updatedAt };
  const target = workspaceProfilePath(cwd);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
  return profile;
}

export async function ensureWorkspaceProfile(cwd: string): Promise<WorkspaceProfile> {
  return await loadWorkspaceProfile(cwd) ?? refreshWorkspaceProfile(cwd);
}

export async function buildWorkspaceProfilePromptBlock(cwd: string): Promise<string> {
  const profile = await ensureWorkspaceProfile(cwd);
  return `\n\nWORKSPACE PROFILE (structured, workspace-scoped):\n${JSON.stringify(profile, null, 2)}`;
}

export function formatWorkspaceProfile(profile: WorkspaceProfile, cwd: string): string {
  return ["**Workspace Profile**", "", `Path: \`${workspaceProfilePath(cwd)}\``, `Name: **${profile.name}**`, profile.purpose ? `Purpose: ${profile.purpose}` : "Purpose: _(not set)_", `Stack: ${profile.stack.join(", ") || "unknown"}`, `Package manager: ${profile.packageManager ?? "unknown"}`, `Commands: ${Object.keys(profile.commands).join(", ") || "none"}`, `Priorities: ${profile.priorities.join(" · ") || "none set"}`].join("\n");
}

function detectStack(pkg: any, cwd: string): string[] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const stack = new Set<string>();
  if (deps.react) stack.add("React");
  if (deps.ink) stack.add("Ink");
  if (deps.next) stack.add("Next.js");
  if (deps.typescript) stack.add("TypeScript");
  if (existsSync(path.join(cwd, "bun.lock")) || existsSync(path.join(cwd, "bun.lockb"))) stack.add("Bun");
  return [...stack];
}
