import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { runCommand } from "../tools/shell";
import { sharedAssetRoot } from "../config/authoring-paths";

export const DEFAULT_ENGINE_BAY_REPO = "https://github.com/genoventures-labs/Switchbay-Engines.git";

export type EngineBayInventory = {
  path: string;
  repo: string;
  exists: boolean;
  head: string | null;
  templates: string[];
  manifests: string[];
  engineFiles: string[];
};

export function engineBayRepoUrl(): string {
  return Bun.env.SWITCHBAY_ENGINE_BAY_REPO?.trim() || DEFAULT_ENGINE_BAY_REPO;
}

export function engineBayCachePath(): string {
  const configured = Bun.env.SWITCHBAY_ENGINE_BAY_PATH?.trim();
  if (configured) return path.resolve(configured.replace(/^~/, os.homedir()));
  return path.join(os.homedir(), ".switchbay", "engine-bay", "Switchbay-Engines");
}

export async function syncEngineBayRepo(): Promise<string> {
  const repo = engineBayRepoUrl();
  const cachePath = engineBayCachePath();
  const parent = path.dirname(cachePath);
  await fs.mkdir(parent, { recursive: true });

  if (existsSync(path.join(cachePath, ".git"))) {
    const pull = await runCommand(["git", "-C", cachePath, "pull", "--ff-only"], parent);
    if (!pull.ok) throw new Error(pull.stderr || pull.stdout || "git pull failed");
    return pull.stdout || "Engine Bay cache already up to date.";
  }

  const clone = await runCommand(["git", "clone", repo, cachePath], parent);
  if (!clone.ok) throw new Error(clone.stderr || clone.stdout || "git clone failed");
  return clone.stdout || clone.stderr || `Cloned ${repo}`;
}

export async function loadEngineBayInventory(): Promise<EngineBayInventory> {
  const cachePath = engineBayCachePath();
  const exists = existsSync(cachePath);
  const [templates, manifests, engineFiles, head]: [string[], string[], string[], string | null] = exists
    ? await Promise.all([
      findRelativeFiles(cachePath, isTemplateFile),
      findRelativeFiles(cachePath, isManifestFile),
      findRelativeFiles(path.join(cachePath, "engines"), () => true),
      readHead(cachePath),
    ])
    : [[], [], [], null];

  return {
    path: cachePath,
    repo: engineBayRepoUrl(),
    exists,
    head,
    templates,
    manifests,
    engineFiles,
  };
}

export async function describeEngineBay(sync = false): Promise<string> {
  let syncMessage = "";
  if (sync) {
    syncMessage = await syncEngineBayRepo();
  }

  const inventory = await loadEngineBayInventory();
  const lines = [
    "Engine Bay",
    `Repo: ${inventory.repo}`,
    `Cache: ${inventory.path}`,
    `Status: ${inventory.exists ? "ready" : "not synced"}`,
  ];

  if (inventory.head) lines.push(`HEAD: ${inventory.head}`);
  if (syncMessage) lines.push(`Sync: ${syncMessage}`);

  lines.push("", "Templates:");
  lines.push(...formatList(inventory.templates));
  lines.push("", "Engine manifests:");
  lines.push(...formatList(inventory.manifests));
  lines.push("", "Engine files:");
  lines.push(...formatList(inventory.engineFiles.slice(0, 40), inventory.engineFiles.length));

  if (!inventory.exists) {
    lines.push("", "Run `/engine-bay sync` or `switchbay engines sync` to clone the hub.");
  }

  return lines.join("\n");
}

export async function engineBayManifestPaths(): Promise<string[]> {
  const inventory = await loadEngineBayInventory();
  const authoringRoot = sharedAssetRoot("engine");
  const authoring = existsSync(authoringRoot)
    ? (await findRelativeFiles(authoringRoot, isManifestFile)).map((file) => path.join(authoringRoot, file))
    : [];
  const cached = inventory.exists ? inventory.manifests.map((file) => path.join(inventory.path, file)) : [];
  return [...new Set([...authoring, ...cached])];
}

async function readHead(repoPath: string): Promise<string | null> {
  const result = await runCommand(["git", "-C", repoPath, "log", "-1", "--oneline"], repoPath);
  return result.ok ? result.stdout || null : null;
}

async function findRelativeFiles(root: string, predicate: (relativePath: string) => boolean): Promise<string[]> {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  await walk(root, "", found, predicate);
  return found.sort((a, b) => a.localeCompare(b));
}

async function walk(root: string, relativeDir: string, found: string[], predicate: (relativePath: string) => boolean): Promise<void> {
  const dir = path.join(root, relativeDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, relativePath, found, predicate);
    } else if (entry.isFile() && predicate(relativePath)) {
      found.push(relativePath);
    }
  }
}

function isTemplateFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return normalized.startsWith("template/") || normalized.startsWith("templates/");
}

function isManifestFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (isTemplateFile(normalized)) return false;
  return normalized.endsWith(".engine.json");
}

function formatList(items: string[], total = items.length): string[] {
  if (!items.length) return ["- (none)"];
  const lines = items.map((item) => `- ${item}`);
  if (total > items.length) lines.push(`- ... ${total - items.length} more`);
  return lines;
}
