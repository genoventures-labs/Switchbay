import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { workspaceStorageDir } from "../config/paths";
import { runCommand } from "../tools/shell";
import { pluginAssetPaths } from "../plugins/registry";
import { sharedAssetRoot } from "../config/authoring-paths";
import { scanMarkdownContent, formatScanFindings } from "../security/scanner";

export const DEFAULT_TOOLBOX_REPO = "https://github.com/genoventures-labs/Engine-Toolboxes.git";

export function sessionSkillsPath(): string {
  return path.join(os.homedir(), ".switchbay", "session-skills");
}

export async function clearSessionSkills(): Promise<void> {
  const dir = sessionSkillsPath();
  await fs.rm(dir, { recursive: true, force: true });
}

export async function createSessionSkill(
  name: string,
  description: string,
  body: string,
  triggers: string[] = [],
): Promise<ToolboxSkill> {
  const dir = sessionSkillsPath();
  await fs.mkdir(dir, { recursive: true });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const triggerLine = triggers.length ? `triggers: [${triggers.join(", ")}]` : "";
  const content = `---\nid: ${id}\nname: ${name}\ndescription: ${description}${triggerLine ? `\n${triggerLine}` : ""}\nsource: session\n---\n\n${body.trim()}\n`;
  const filePath = path.join(dir, `${id}.skill.md`);
  await Bun.write(filePath, content);
  return {
    id,
    name,
    description,
    languages: ["any"],
    agents: ["any"],
    tags: [],
    triggers,
    path: filePath,
    source: "session",
    body: body.trim(),
  };
}

export type ToolboxSkill = {
  id: string;
  name: string;
  description: string;
  languages: string[];
  agents: string[];
  tags: string[];
  triggers: string[];
  path: string;
  source: "builtin" | "synced" | "workspace" | "global" | "plugin" | "session";
  body: string;
};

export type ToolboxInventory = {
  path: string;
  repo: string;
  exists: boolean;
  head: string | null;
  templates: string[];
  skills: ToolboxSkill[];
};

export function toolboxRepoUrl(): string {
  return Bun.env.SWITCHBAY_TOOLBOX_REPO?.trim() || DEFAULT_TOOLBOX_REPO;
}

export function toolboxCachePath(): string {
  const configured = Bun.env.SWITCHBAY_TOOLBOX_PATH?.trim();
  if (configured) return path.resolve(configured.replace(/^~/, os.homedir()));
  return path.join(os.homedir(), ".switchbay", "toolbox", "Engine-Toolboxes");
}

export function builtinToolboxPath(): string {
  return path.resolve(import.meta.dir, "..", "..", "toolbox");
}

export async function syncToolboxRepo(): Promise<string> {
  const repo = toolboxRepoUrl();
  const cachePath = toolboxCachePath();
  const parent = path.dirname(cachePath);
  await fs.mkdir(parent, { recursive: true });

  if (existsSync(path.join(cachePath, ".git"))) {
    const pull = await runCommand(["git", "-C", cachePath, "pull", "--ff-only"], parent);
    if (!pull.ok) throw new Error(pull.stderr || pull.stdout || "git pull failed");
    return pull.stdout || "Toolbox cache already up to date.";
  }

  const clone = await runCommand(["git", "clone", repo, cachePath], parent);
  if (!clone.ok) throw new Error(clone.stderr || clone.stdout || "git clone failed");
  return clone.stdout || clone.stderr || `Cloned ${repo}`;
}

export type BlockDetail = { name: string; findings: string };
export type SyncDiff = { before: number; after: number; added: number; blocked: number; blockDetails: BlockDetail[] };

export async function syncToolboxWithDiff(cwd = process.cwd()): Promise<SyncDiff> {
  const before = (await loadToolboxInventory(cwd)).skills.length;
  await syncToolboxRepo();
  const after = (await loadToolboxInventory(cwd)).skills.length;

  // Scan all synced skills for prompt injection and security issues
  const blockDetails: BlockDetail[] = [];
  const cachePath = toolboxCachePath();
  if (existsSync(cachePath)) {
    const files = await findRelativeFiles(cachePath, isSkillFile);
    await Promise.all(
      files.map(async (file) => {
        try {
          const content = await fs.readFile(path.join(cachePath, file), "utf-8");
          const scan = scanMarkdownContent(content);
          if (!scan.safe) {
            const name = path.basename(file, ".skill.md").replace(/\.md$/i, "");
            blockDetails.push({ name, findings: formatScanFindings(scan.findings) });
          }
        } catch { /* skip */ }
      }),
    );
  }

  return { before, after, added: Math.max(0, after - before), blocked: blockDetails.length, blockDetails };
}

export async function loadToolboxInventory(cwd = process.cwd()): Promise<ToolboxInventory> {
  const cachePath = toolboxCachePath();
  const exists = existsSync(cachePath);
  const builtinPath = builtinToolboxPath();
  const workspacePath = path.join(workspaceStorageDir(cwd), "toolbox");
  const authoringPath = sharedAssetRoot("skill", cwd);
  const engineAuthoringEnginesPath = path.join(sharedAssetRoot("engine", cwd), "engines");
  const sessionPath = sessionSkillsPath();
  const [builtinSkills, authoringSkills, engineAuthoringSkills, syncedSkills, workspaceSkills, pluginSkills, sessionSkills, templates, head] = await Promise.all([
    loadSkillsFromRoot(builtinPath, "builtin"),
    loadSkillsFromRoot(authoringPath, "workspace"),
    loadSkillsFromRoot(engineAuthoringEnginesPath, "workspace"),
    exists ? loadSkillsFromRoot(cachePath, "synced") : Promise.resolve([]),
    loadSkillsFromRoot(workspacePath, "workspace"),
    loadPluginSkills(cwd),
    loadSkillsFromRoot(sessionPath, "session"),
    exists ? findRelativeFiles(cachePath, isTemplateFile) : Promise.resolve([]),
    exists ? readHead(cachePath) : Promise.resolve(null),
  ]);

  const merged = mergeSkills([...sessionSkills, ...authoringSkills, ...engineAuthoringSkills, ...builtinSkills, ...syncedSkills, ...workspaceSkills, ...pluginSkills]);
  return {
    path: cachePath,
    repo: toolboxRepoUrl(),
    exists,
    head,
    templates,
    skills: merged,
  };
}

export async function describeToolbox(sync = false): Promise<string> {
  let syncMessage = "";
  if (sync) syncMessage = await syncToolboxRepo();

  const inventory = await loadToolboxInventory();
  const lines = [
    "Skills",
    `Repo: ${inventory.repo}`,
    `Cache: ${inventory.path}`,
    `Status: ${inventory.exists ? "ready" : "not synced"}`,
  ];
  if (inventory.head) lines.push(`HEAD: ${inventory.head}`);
  if (syncMessage) lines.push(`Sync: ${syncMessage}`);

  lines.push("", "Skills:");
  lines.push(...formatSkillList(inventory.skills));
  lines.push("", "Templates:");
  lines.push(...formatList(inventory.templates));

  if (!inventory.exists) {
    lines.push("", "Run `/skills sync` or `switchbay skills sync` to clone the skills repo.");
  }

  return lines.join("\n");
}

export async function readToolboxSkill(id: string): Promise<ToolboxSkill | null> {
  const inventory = await loadToolboxInventory();
  const normalized = id.trim().toLowerCase();
  return inventory.skills.find((skill) => skill.id.toLowerCase() === normalized || skill.name.toLowerCase() === normalized) ?? null;
}

export async function buildToolboxPromptBlock(maxSkills = 7): Promise<string> {
  const inventory = await loadToolboxInventory();
  if (!inventory.skills.length) return "";
  const summaries = inventory.skills.slice(0, maxSkills).map((skill) => [
    `### ${skill.name} (${skill.id})`,
    skill.description,
    `Use when: ${skill.triggers.slice(0, 6).join(", ") || skill.tags.slice(0, 6).join(", ") || "the task matches this method"}.`,
    `Agents: ${skill.agents.join(", ") || "any"}; Languages: ${skill.languages.join(", ") || "any"}.`,
    compactBody(skill.body),
  ].filter(Boolean).join("\n"));

  return `\n\nTOOLBOX SKILLS (reusable working methods available this session):\n${summaries.join("\n\n")}`;
}

async function loadSkillsFromRoot(root: string, source: ToolboxSkill["source"]): Promise<ToolboxSkill[]> {
  if (!existsSync(root)) return [];
  const files = await findRelativeFiles(root, isSkillFile);
  const skills: ToolboxSkill[] = [];
  const externalSource = source === "synced" || source === "plugin";
  for (const file of files) {
    try {
      const absolute = path.join(root, file);
      const content = await fs.readFile(absolute, "utf-8");
      if (externalSource) {
        const scan = scanMarkdownContent(content);
        if (!scan.safe) continue;
      }
      skills.push(parseSkillMarkdown(content, absolute, source));
    } catch {
      // Skip malformed or unreadable skill files.
    }
  }
  return skills;
}

async function loadPluginSkills(cwd: string): Promise<ToolboxSkill[]> {
  const files = await pluginAssetPaths("skills", cwd);
  const skills: ToolboxSkill[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const scan = scanMarkdownContent(content);
      if (!scan.safe) continue;
      skills.push(parseSkillMarkdown(content, file, "plugin"));
    } catch {
      // Skip malformed or unreadable plugin skills.
    }
  }
  return skills;
}

function parseSkillMarkdown(content: string, relativePath: string, source: ToolboxSkill["source"]): ToolboxSkill {
  const { meta, body } = parseFrontmatter(content);
  const fallbackId = path.basename(relativePath).replace(/\.skill\.md$|\.md$/i, "");
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    id: stringMeta(meta.id, fallbackId),
    name: stringMeta(meta.name, title ?? fallbackId),
    description: stringMeta(meta.description, ""),
    languages: listMeta(meta.languages, ["any"]),
    agents: listMeta(meta.agents, ["any"]),
    tags: listMeta(meta.tags, []),
    triggers: listMeta(meta.triggers, []),
    path: relativePath,
    source,
    body: body.trim(),
  };
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  if (!content.startsWith("---\n")) return { meta: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: content };
  const raw = content.slice(4, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");
  const meta: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body };
}

function stringMeta(value: string | undefined, fallback: string): string {
  return value?.trim().replace(/^["']|["']$/g, "") || fallback;
}

function listMeta(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const trimmed = value.trim();
  const body = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const items = body.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return items.length ? items : fallback;
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

function isSkillFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (isTemplateFile(normalized)) return false;
  // Match any .skill.md anywhere in the tree (including subfolders models may create).
  if (normalized.endsWith(".skill.md")) return true;
  // Also match plain .md files inside any folder named "skills" at any depth.
  const parts = normalized.split("/");
  const inSkillsDir = parts.slice(0, -1).some((part) => part === "skills");
  return inSkillsDir && normalized.endsWith(".md");
}

function isTemplateFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return normalized.startsWith("template/") || normalized.startsWith("templates/");
}

function mergeSkills(skills: ToolboxSkill[]): ToolboxSkill[] {
  const merged = new Map<string, ToolboxSkill>();
  for (const skill of skills) {
    merged.set(skill.id, skill);
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function compactBody(body: string): string {
  const useWhen = extractSection(body, "Use When");
  const method = extractSection(body, "Method");
  const guardrails = extractSection(body, "Guardrails");
  return [
    useWhen ? `Use when:\n${limitLines(useWhen, 4)}` : "",
    method ? `Method:\n${limitLines(method, 6)}` : "",
    guardrails ? `Guardrails:\n${limitLines(guardrails, 3)}` : "",
  ].filter(Boolean).join("\n");
}

function extractSection(body: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|\\z)`, "m");
  return body.match(pattern)?.[1]?.trim() ?? "";
}

function limitLines(value: string, count: number): string {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, count).join("\n");
}

function formatSkillList(skills: ToolboxSkill[]): string[] {
  if (!skills.length) return ["- (none)"];
  return skills.map((skill) => `- ${skill.id} - ${skill.name}: ${skill.description}`);
}

function formatList(items: string[]): string[] {
  if (!items.length) return ["- (none)"];
  return items.map((item) => `- ${item}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
