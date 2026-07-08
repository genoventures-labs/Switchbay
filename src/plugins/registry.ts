import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { workspaceStorageDir } from "../config/paths";

export type PluginAssetKind = "agents" | "skills" | "engines" | "guides" | "knowledge" | "mcp";

export type SwitchbayPluginManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  agents: string[];
  skills: string[];
  engines: string[];
  guides: string[];
  knowledge: string[];
  mcp: string[];
};

export type LoadedSwitchbayPlugin = {
  manifest: SwitchbayPluginManifest;
  root: string;
  manifestPath: string;
  missing: Record<PluginAssetKind, string[]>;
};

export type PluginInventory = {
  path: string;
  plugins: LoadedSwitchbayPlugin[];
  warnings: string[];
};

const ASSET_KINDS: PluginAssetKind[] = ["agents", "skills", "engines", "guides", "knowledge", "mcp"];

export function pluginsRoot(cwd = process.cwd()): string {
  return path.join(workspaceStorageDir(cwd), "plugins");
}

export async function loadPluginInventory(cwd = process.cwd()): Promise<PluginInventory> {
  const root = pluginsRoot(cwd);
  const warnings: string[] = [];
  const plugins: LoadedSwitchbayPlugin[] = [];

  if (!existsSync(root)) return { path: root, plugins, warnings };

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    return {
      path: root,
      plugins,
      warnings: [`${root}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginRoot = path.join(root, entry.name);
    const manifestPath = path.join(pluginRoot, "plugin.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const manifest = normalizePluginManifest(JSON.parse(raw));
      const missing = await collectMissingAssets(pluginRoot, manifest);
      plugins.push({ manifest, root: pluginRoot, manifestPath, missing });
    } catch (err) {
      warnings.push(`${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    path: root,
    plugins: plugins.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
    warnings,
  };
}

export async function describePlugins(cwd = process.cwd()): Promise<string> {
  const inventory = await loadPluginInventory(cwd);
  const lines = [
    "Plugins",
    `Path: ${inventory.path}`,
    `Status: ${inventory.plugins.length ? "ready" : "none installed"}`,
    "",
    "Installed:",
  ];

  if (!inventory.plugins.length) {
    lines.push("- (none)");
  } else {
    for (const plugin of inventory.plugins) {
      const status = plugin.manifest.enabled ? "enabled" : "disabled";
      const counts = ASSET_KINDS
        .map((kind) => `${kind}:${plugin.manifest[kind].length}`)
        .join(" ");
      lines.push(`- ${plugin.manifest.id} - ${plugin.manifest.name} (${status}) ${counts}`);
      if (plugin.manifest.description) lines.push(`  ${plugin.manifest.description}`);
      const missing = ASSET_KINDS.flatMap((kind) =>
        plugin.missing[kind].map((asset) => `${kind}/${asset}`),
      );
      if (missing.length) lines.push(`  Missing: ${missing.join(", ")}`);
    }
  }

  if (inventory.warnings.length) {
    lines.push("", "Warnings:", ...inventory.warnings.map((warning) => `- ${warning}`));
  }

  lines.push("", "Create one with `/create-plugin` or place a manifest at `.switchbay/plugins/<id>/plugin.json`.");
  return lines.join("\n");
}

export async function readPlugin(id: string, cwd = process.cwd()): Promise<LoadedSwitchbayPlugin | null> {
  const normalized = id.trim().toLowerCase();
  const inventory = await loadPluginInventory(cwd);
  return inventory.plugins.find((plugin) =>
    plugin.manifest.id.toLowerCase() === normalized ||
    plugin.manifest.name.toLowerCase() === normalized
  ) ?? null;
}

export async function pluginAssetPaths(kind: PluginAssetKind, cwd = process.cwd()): Promise<string[]> {
  const inventory = await loadPluginInventory(cwd);
  const paths: string[] = [];

  for (const plugin of inventory.plugins) {
    if (!plugin.manifest.enabled) continue;
    for (const asset of plugin.manifest[kind]) {
      if (!isSafeRelativePath(asset)) continue;
      const absolute = path.join(plugin.root, asset);
      if (existsSync(absolute)) paths.push(absolute);
    }
  }

  return paths;
}

export function normalizePluginManifest(raw: unknown): SwitchbayPluginManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Plugin manifest must be a JSON object.");
  }
  const manifest = raw as Partial<Record<keyof SwitchbayPluginManifest, unknown>>;
  const id = String(manifest.id ?? "").trim();
  if (!id || !/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) {
    throw new Error("Plugin requires an id using letters, numbers, underscores, or hyphens.");
  }
  const name = String(manifest.name ?? "").trim();
  if (!name) throw new Error("Plugin requires a name.");

  const normalized: SwitchbayPluginManifest = {
    id,
    name,
    description: String(manifest.description ?? "").trim(),
    version: String(manifest.version ?? "0.1.0").trim() || "0.1.0",
    enabled: manifest.enabled === false ? false : true,
    agents: normalizeAssetList(manifest.agents, "agents", isAgentAsset),
    skills: normalizeAssetList(manifest.skills, "skills", isSkillAsset),
    engines: normalizeAssetList(manifest.engines, "engines", isEngineAsset),
    guides: normalizeAssetList(manifest.guides, "guides", isGuideAsset),
    knowledge: normalizeAssetList(manifest.knowledge, "knowledge", isKnowledgeAsset),
    mcp: normalizeAssetList(manifest.mcp, "mcp", isMcpAsset),
  };

  return normalized;
}

export function pluginManifestTemplate(id: string, name: string, description: string): SwitchbayPluginManifest {
  return {
    id,
    name,
    description,
    version: "0.1.0",
    enabled: true,
    agents: [],
    skills: [],
    engines: [],
    guides: [],
    knowledge: [],
    mcp: [],
  };
}

async function collectMissingAssets(
  root: string,
  manifest: SwitchbayPluginManifest,
): Promise<Record<PluginAssetKind, string[]>> {
  const missing: Record<PluginAssetKind, string[]> = {
    agents: [],
    skills: [],
    engines: [],
    guides: [],
    knowledge: [],
    mcp: [],
  };
  for (const kind of ASSET_KINDS) {
    for (const asset of manifest[kind]) {
      const absolute = path.join(root, asset);
      if (!existsSync(absolute)) missing[kind].push(asset);
    }
  }
  return missing;
}

function normalizeAssetList(
  value: unknown,
  kind: PluginAssetKind,
  accepts: (value: string) => boolean,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Plugin ${kind} must be an array of relative paths.`);

  const assets: string[] = [];
  for (const item of value) {
    const asset = String(item ?? "").trim().replace(/\\/g, "/");
    if (!asset) continue;
    if (!isSafeRelativePath(asset)) {
      throw new Error(`Plugin ${kind} asset must be a safe relative path: ${asset}`);
    }
    if (!accepts(asset)) {
      throw new Error(`Plugin ${kind} asset has an unsupported path or extension: ${asset}`);
    }
    assets.push(asset);
  }
  return [...new Set(assets)];
}

function isSafeRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) return false;
  const normalized = path.normalize(value).replace(/\\/g, "/");
  return normalized === value && !normalized.startsWith("../") && normalized !== ".." && !normalized.includes("/../");
}

function isAgentAsset(value: string): boolean {
  return value.startsWith("agents/") && value.endsWith(".md");
}

function isSkillAsset(value: string): boolean {
  return value.startsWith("skills/") && (value.endsWith(".skill.md") || value.endsWith(".md"));
}

function isEngineAsset(value: string): boolean {
  return value.startsWith("engines/") && value.endsWith(".engine.json");
}

function isGuideAsset(value: string): boolean {
  return value.startsWith("guides/") && value.endsWith(".md");
}

function isKnowledgeAsset(value: string): boolean {
  return value.startsWith("knowledge/") && (value.endsWith(".md") || value.endsWith(".json") || value.endsWith(".txt"));
}

function isMcpAsset(value: string): boolean {
  return value.startsWith("mcp/") && value.endsWith(".json");
}
