import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { existingProjectContextPath, existingWorkspaceDataPath, workspaceDataPath, workspaceStorageDir } from "../config/paths";
import { runCommand } from "../tools/shell";

export type MemoryConfig = {
  maxNotesInPrompt: number;
  maxSummaryChars: number;
  includeGitSnapshot: boolean;
};

export type MemoryFact = {
  key: string;
  value: string;
  source: string;
  updatedAt: string;
};

const DEFAULT_CONFIG: MemoryConfig = {
  maxNotesInPrompt: 12,
  maxSummaryChars: 2400,
  includeGitSnapshot: true,
};

export function memoryDir(cwd: string): string {
  return path.join(workspaceStorageDir(cwd), "memory");
}

export function memoryPaths(cwd: string) {
  const dir = memoryDir(cwd);
  return {
    dir,
    config: path.join(dir, "config.json"),
    facts: path.join(dir, "facts.json"),
    notes: path.join(dir, "notes.md"),
    summary: path.join(dir, "summary.md"),
    legacyNotes: workspaceDataPath(cwd, "memory.md"),
  };
}

export async function loadMemoryConfig(cwd: string): Promise<MemoryConfig> {
  const paths = memoryPaths(cwd);
  try {
    const parsed = JSON.parse(await fs.readFile(paths.config, "utf-8")) as Partial<MemoryConfig>;
    return {
      maxNotesInPrompt: positiveInt(parsed.maxNotesInPrompt, DEFAULT_CONFIG.maxNotesInPrompt),
      maxSummaryChars: positiveInt(parsed.maxSummaryChars, DEFAULT_CONFIG.maxSummaryChars),
      includeGitSnapshot: parsed.includeGitSnapshot ?? DEFAULT_CONFIG.includeGitSnapshot,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function ensureMemoryStore(cwd: string): Promise<void> {
  const paths = memoryPaths(cwd);
  await fs.mkdir(paths.dir, { recursive: true });
  if (!existsSync(paths.config)) {
    await fs.writeFile(paths.config, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
  if (!existsSync(paths.notes)) {
    const legacy = readLegacyNotes(cwd);
    await fs.writeFile(paths.notes, legacy.length ? `${legacy.map((note) => `- ${note}`).join("\n")}\n` : "", "utf-8");
  }
  if (!existsSync(paths.facts)) {
    await fs.writeFile(paths.facts, "[]\n", "utf-8");
  }
}

export async function addMemoryNote(cwd: string, note: string): Promise<number> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("Memory note cannot be empty.");
  await ensureMemoryStore(cwd);
  const notes = await listMemoryNotes(cwd);
  notes.push(trimmed);
  await writeNotes(cwd, notes);
  await writeLegacyNotes(cwd, notes);
  return notes.length;
}

export async function listMemoryNotes(cwd: string): Promise<string[]> {
  await ensureMemoryStore(cwd);
  const paths = memoryPaths(cwd);
  try {
    return parseNotes(await fs.readFile(paths.notes, "utf-8"));
  } catch {
    return readLegacyNotes(cwd);
  }
}

export async function forgetMemoryNote(cwd: string, index: number): Promise<string | null> {
  await ensureMemoryStore(cwd);
  const notes = await listMemoryNotes(cwd);
  if (index < 0 || index >= notes.length) return null;
  const [removed] = notes.splice(index, 1);
  await writeNotes(cwd, notes);
  await writeLegacyNotes(cwd, notes);
  return removed ?? null;
}

export async function readMemoryFacts(cwd: string): Promise<MemoryFact[]> {
  await ensureMemoryStore(cwd);
  try {
    const parsed = JSON.parse(await fs.readFile(memoryPaths(cwd).facts, "utf-8"));
    return Array.isArray(parsed) ? parsed.filter(isMemoryFact) : [];
  } catch {
    return [];
  }
}

export async function refreshMemory(cwd: string): Promise<string> {
  await ensureMemoryStore(cwd);
  const paths = memoryPaths(cwd);
  const config = await loadMemoryConfig(cwd);
  const now = new Date().toISOString();
  const facts: MemoryFact[] = [];
  const summary: string[] = [`# Operational Memory`, "", `Refreshed: ${now}`];

  const contextPath = existingProjectContextPath(cwd);
  if (contextPath && existsSync(contextPath)) {
    const context = readFileSync(contextPath, "utf-8").trim();
    if (context) {
      facts.push({ key: "project.context_path", value: path.relative(cwd, contextPath), source: "project_context", updatedAt: now });
      summary.push("", "## Project Context", trimChars(context, 900));
    }
  }

  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf-8")) as {
      name?: string;
      description?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.name) facts.push({ key: "package.name", value: pkg.name, source: "package.json", updatedAt: now });
    if (pkg.description) facts.push({ key: "package.description", value: pkg.description, source: "package.json", updatedAt: now });
    if (pkg.scripts) facts.push({ key: "package.scripts", value: Object.keys(pkg.scripts).join(", "), source: "package.json", updatedAt: now });
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 30);
    summary.push("", "## Package", [
      pkg.name ? `Name: ${pkg.name}` : "",
      pkg.description ? `Description: ${pkg.description}` : "",
      pkg.scripts ? `Scripts: ${Object.keys(pkg.scripts).join(", ")}` : "",
      deps.length ? `Dependencies: ${deps.join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  } catch {
    // No package metadata.
  }

  if (config.includeGitSnapshot) {
    const [branch, status, log] = await Promise.all([
      runCommand(["git", "branch", "--show-current"], cwd),
      runCommand(["git", "status", "--short"], cwd),
      runCommand(["git", "log", "-5", "--oneline"], cwd),
    ]);
    if (branch.ok && branch.stdout) facts.push({ key: "git.branch", value: branch.stdout, source: "git", updatedAt: now });
    summary.push("", "## Git", [
      branch.ok && branch.stdout ? `Branch: ${branch.stdout}` : "",
      status.ok ? `Working tree: ${status.stdout || "clean"}` : "",
      log.ok && log.stdout ? `Recent commits:\n${log.stdout}` : "",
    ].filter(Boolean).join("\n"));
  }

  const notes = await listMemoryNotes(cwd);
  if (notes.length) {
    summary.push("", "## Notes", ...notes.slice(-20).map((note) => `- ${note}`));
  }

  const summaryText = summary.join("\n").trim() + "\n";
  await fs.writeFile(paths.summary, summaryText, "utf-8");
  await fs.writeFile(paths.facts, JSON.stringify(facts, null, 2) + "\n", "utf-8");
  return summaryText;
}

export async function buildMemoryPromptBlock(cwd: string): Promise<string> {
  const paths = memoryPaths(cwd);
  const legacyPath = existingWorkspaceDataPath(cwd, "memory.md");
  if (!existsSync(paths.dir) && !existsSync(legacyPath)) return "";
  const config = await loadMemoryConfig(cwd);
  const notes = await listMemoryNotes(cwd);
  let summary = "";
  try {
    summary = (await fs.readFile(paths.summary, "utf-8")).trim();
  } catch {
    // Summary is optional until refresh.
  }
  const recentNotes = notes.slice(-config.maxNotesInPrompt);
  const parts = [
    summary ? `Summary:\n${trimChars(summary, config.maxSummaryChars)}` : "",
    recentNotes.length ? `Notes:\n${recentNotes.map((note) => `- ${note}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? `\n\nOPERATIONAL MEMORY (workspace-scoped, concise):\n${parts.join("\n\n")}` : "";
}

export async function describeMemory(cwd: string): Promise<string> {
  await ensureMemoryStore(cwd);
  const paths = memoryPaths(cwd);
  const notes = await listMemoryNotes(cwd);
  const facts = await readMemoryFacts(cwd);
  const hasSummary = existsSync(paths.summary);
  return [
    "Memory",
    `Dir: ${path.relative(cwd, paths.dir)}`,
    `Notes: ${notes.length}`,
    `Facts: ${facts.length}`,
    `Summary: ${hasSummary ? path.relative(cwd, paths.summary) : "(not refreshed)"}`,
    "",
    notes.length ? notes.map((note, index) => `${index}. ${note}`).join("\n") : "No notes yet. Add one with `/remember <note>`.",
  ].join("\n");
}

async function writeNotes(cwd: string, notes: string[]): Promise<void> {
  await fs.writeFile(memoryPaths(cwd).notes, notes.map((note) => `- ${note}`).join("\n") + (notes.length ? "\n" : ""), "utf-8");
}

async function writeLegacyNotes(cwd: string, notes: string[]): Promise<void> {
  await fs.mkdir(workspaceStorageDir(cwd), { recursive: true });
  await fs.writeFile(memoryPaths(cwd).legacyNotes, notes.map((note) => `- ${note}`).join("\n") + (notes.length ? "\n" : ""), "utf-8");
}

function readLegacyNotes(cwd: string): string[] {
  const legacy = existingWorkspaceDataPath(cwd, "memory.md");
  if (!existsSync(legacy)) return [];
  try {
    return parseNotes(readFileSync(legacy, "utf-8"));
  } catch {
    return [];
  }
}

function parseNotes(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function isMemoryFact(value: unknown): value is MemoryFact {
  return Boolean(value && typeof value === "object"
    && typeof (value as MemoryFact).key === "string"
    && typeof (value as MemoryFact).value === "string");
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimChars(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n... [truncated]` : value;
}
