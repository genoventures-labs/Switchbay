import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export type SharedAssetKind = "engine" | "skill" | "plugin";

export function sharedAssetRoot(kind: SharedAssetKind, cwd = process.cwd()): string {
  const configured = Bun.env[envName(kind)]?.trim();
  if (configured) return resolve(expandHome(configured));

  const githubRoots = [join(homedir(), "Documents", "GitHub"), join(homedir(), "Documents", "Git Hub")];
  const repoNames = kind === "engine"
    ? ["Switchbay Engines", "Switchbay-Engines"]
    : kind === "skill"
      ? ["Engine Toolboxes", "Engine-Toolboxes"]
      : ["Switchbay"];
  for (const root of githubRoots) {
    for (const repo of repoNames) {
      const candidate = join(root, repo);
      if (existsSync(join(candidate, ".git"))) return candidate;
    }
  }
  return kind === "plugin" ? cwd : join(homedir(), "Documents", "GitHub", repoNames[0]!);
}

export function engineAuthoringPath(input: { id: string; name: string; commands?: string }, cwd = process.cwd()): string {
  const language = inferEngineLanguage(input.commands ?? "");
  const folder = pascalFolder(input.name || input.id);
  const file = `${input.id.replace(/-/g, "_")}.engine.json`;
  return join(sharedAssetRoot("engine", cwd), "engines", language, folder, file);
}

export function skillAuthoringPath(id: string, cwd = process.cwd()): string {
  return join(sharedAssetRoot("skill", cwd), "skills", `${id}.skill.md`);
}

export function pluginAuthoringPath(id: string, cwd = process.cwd()): string {
  return join(sharedAssetRoot("plugin", cwd), "plugins", id, "plugin.json");
}

export function describeSharedAssetRoots(cwd = process.cwd()): string {
  return [
    `Engine source repository: ${sharedAssetRoot("engine", cwd)}`,
    `Skill source repository: ${sharedAssetRoot("skill", cwd)}`,
    `Plugin source repository: ${sharedAssetRoot("plugin", cwd)}`,
    "Reusable assets must be authored in these source repositories, not in the disposable native environment or cache under ~/.switchbay.",
  ].join("\n");
}

function envName(kind: SharedAssetKind): string {
  if (kind === "engine") return "SWITCHBAY_ENGINE_AUTHORING_PATH";
  if (kind === "skill") return "SWITCHBAY_SKILL_AUTHORING_PATH";
  return "SWITCHBAY_PLUGIN_AUTHORING_PATH";
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function inferEngineLanguage(commands: string): "Python" | "Node" | "Ruby" | "Shell" {
  const value = commands.toLowerCase();
  if (/\b(python|python3|pip|\.py)\b/.test(value)) return "Python";
  if (/\b(node|bun|npm|npx|tsx|javascript|typescript|\.m?js|\.ts)\b/.test(value)) return "Node";
  if (/\b(ruby|bundle|gem|\.rb)\b/.test(value)) return "Ruby";
  return "Shell";
}

function pascalFolder(value: string): string {
  const result = value.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  return result || basename(value) || "Engine";
}
