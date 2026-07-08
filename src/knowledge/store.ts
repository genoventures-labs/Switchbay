import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceDataPath } from "../config/paths";
import { runCommand } from "../tools/shell";

export type KnowledgeChunk = {
  id: string;
  path: string;
  kind: KnowledgeKind;
  startLine: number;
  endLine: number;
  text: string;
};

export type KnowledgeKind = "code" | "docs" | "memory" | "rules" | "engine" | "toolbox" | "config" | "other";

export type KnowledgeIndex = {
  version: 1;
  cwd: string;
  createdAt: string;
  fileCount: number;
  chunkCount: number;
  chunks: KnowledgeChunk[];
};

export type KnowledgeSearchHit = KnowledgeChunk & {
  score: number;
};

const KNOWLEDGE_FILE = "knowledge/index.json";
const MAX_FILE_BYTES = 180_000;
const MAX_FILES = 550;
const CHUNK_LINES = 80;
const CHUNK_OVERLAP = 12;
const MAX_PROMPT_HITS = 5;

const INDEXABLE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const INDEXABLE_NAMES = new Set([
  "AGENTS.md",
  "README",
  "README.md",
  "SWITCHBAY.md",
  "package.json",
  "Gemfile",
  "Makefile",
  "Dockerfile",
]);

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "before",
  "bro",
  "but",
  "can",
  "could",
  "for",
  "from",
  "get",
  "has",
  "have",
  "how",
  "into",
  "lets",
  "like",
  "make",
  "need",
  "our",
  "that",
  "the",
  "this",
  "use",
  "what",
  "when",
  "where",
  "with",
  "you",
]);

export function knowledgeIndexPath(cwd = process.cwd()): string {
  return workspaceDataPath(cwd, KNOWLEDGE_FILE);
}

export async function refreshKnowledgeIndex(cwd = process.cwd()): Promise<KnowledgeIndex> {
  const files = await listIndexableFiles(cwd);
  const chunks: KnowledgeChunk[] = [];

  for (const relativePath of files.slice(0, MAX_FILES)) {
    const absolutePath = path.join(cwd, relativePath);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;

      const content = await readFile(absolutePath, "utf-8");
      if (looksBinary(content)) continue;

      chunks.push(...chunkFile(relativePath, content));
    } catch {
      // Ignore files that disappeared or cannot be read.
    }
  }

  const index: KnowledgeIndex = {
    version: 1,
    cwd,
    createdAt: new Date().toISOString(),
    fileCount: Math.min(files.length, MAX_FILES),
    chunkCount: chunks.length,
    chunks,
  };

  const indexPath = knowledgeIndexPath(cwd);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  return index;
}

export async function loadKnowledgeIndex(cwd = process.cwd()): Promise<KnowledgeIndex | null> {
  const indexPath = knowledgeIndexPath(cwd);
  if (!existsSync(indexPath)) return null;

  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf-8")) as KnowledgeIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function describeKnowledgeIndex(cwd = process.cwd()): Promise<string> {
  const index = await loadKnowledgeIndex(cwd);
  const indexPath = knowledgeIndexPath(cwd);
  if (!index) {
    return [
      "**Workspace Knowledge**",
      "",
      `Index: \`${indexPath}\` (not created yet)`,
      "",
      "Run `/index refresh` or `switchbay knowledge refresh` to build the local workspace map.",
    ].join("\n");
  }

  return [
    "**Workspace Knowledge**",
    "",
    `Index: \`${indexPath}\``,
    `Refreshed: \`${index.createdAt}\``,
    `Files: \`${index.fileCount}\``,
    `Chunks: \`${index.chunkCount}\``,
    "",
    "Use `/search <query>` to pull sourced workspace snippets.",
  ].join("\n");
}

export async function searchKnowledgeIndex(
  query: string,
  cwd = process.cwd(),
  limit = 8,
): Promise<KnowledgeSearchHit[]> {
  const index = await loadKnowledgeIndex(cwd);
  if (!index) return [];

  const terms = tokenize(query);
  if (!terms.length) return [];

  return index.chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export async function buildKnowledgePromptBlock(
  query: string,
  cwd = process.cwd(),
): Promise<string> {
  const hits = await searchKnowledgeIndex(query, cwd, MAX_PROMPT_HITS);
  if (!hits.length) return "";

  return [
    "",
    "",
    "WORKSPACE KNOWLEDGE MAP (retrieved local source snippets; cite path:line when used):",
    ...hits.map((hit, index) => [
      `Source ${index + 1}: ${hit.path}:${hit.startLine}-${hit.endLine} [${hit.kind}, score ${hit.score}]`,
      "```",
      trimSnippet(hit.text, 900),
      "```",
    ].join("\n")),
  ].join("\n\n");
}

export function formatKnowledgeSearchResults(hits: KnowledgeSearchHit[]): string {
  if (!hits.length) {
    return "No workspace knowledge hits. Run `/index refresh` first, or try a more specific query.";
  }

  return hits.map((hit, index) => [
    `${index + 1}. \`${hit.path}:${hit.startLine}-${hit.endLine}\` (${hit.kind}, score ${hit.score})`,
    trimSnippet(hit.text, 420),
  ].join("\n")).join("\n\n");
}

async function listIndexableFiles(cwd: string): Promise<string[]> {
  const result = await runCommand(["rg", "--files", "--hidden", "--glob", "!.git", "--glob", "!node_modules", "--glob", "!dist", "--glob", "!build", "--glob", "!.switchbay/knowledge"], cwd);
  if (!result.ok) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(shouldIndexPath)
    .sort();
}

function shouldIndexPath(relativePath: string): boolean {
  const name = path.basename(relativePath);
  if (INDEXABLE_NAMES.has(name)) return true;
  const extension = path.extname(relativePath).toLowerCase();
  return INDEXABLE_EXTENSIONS.has(extension);
}

function chunkFile(relativePath: string, content: string): KnowledgeChunk[] {
  const lines = content.split("\n");
  const chunks: KnowledgeChunk[] = [];
  const kind = classifyPath(relativePath);
  const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP);

  for (let start = 0; start < lines.length; start += step) {
    const selected = lines.slice(start, start + CHUNK_LINES);
    const text = selected.join("\n").trim();
    if (!text) continue;

    const startLine = start + 1;
    const endLine = Math.min(lines.length, start + selected.length);
    chunks.push({
      id: `${relativePath}:${startLine}-${endLine}`,
      path: relativePath,
      kind,
      startLine,
      endLine,
      text,
    });

    if (start + CHUNK_LINES >= lines.length) break;
  }

  return chunks;
}

function classifyPath(relativePath: string): KnowledgeKind {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const extension = path.extname(normalized);
  if (normalized.includes(".switchbay/memory")) return "memory";
  if (normalized.includes(".switchbay/rules") || normalized.includes("/rules/")) return "rules";
  if (normalized.includes(".switchbay/engines") || normalized.includes("/engines/")) return "engine";
  if (normalized.includes("toolbox") || normalized.includes("/skills/")) return "toolbox";
  if (extension === ".md" || extension === ".mdx" || extension === ".txt") return "docs";
  if (extension === ".json" || extension === ".toml" || extension === ".yaml" || extension === ".yml") return "config";
  if ([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".mjs", ".py", ".rb", ".rs", ".sh", ".swift", ".ts", ".tsx"].includes(extension)) return "code";
  return "other";
}

function scoreChunk(chunk: KnowledgeChunk, terms: string[]): number {
  const haystack = `${chunk.path}\n${chunk.text}`.toLowerCase();
  const pathText = chunk.path.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const bodyMatches = countOccurrences(haystack, term);
    if (bodyMatches > 0) score += Math.min(8, bodyMatches);
    if (pathText.includes(term)) score += 5;
  }

  if (chunk.kind === "docs" || chunk.kind === "memory" || chunk.kind === "rules") score += 1;
  return score;
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  return value
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .slice(0, 16);
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let position = value.indexOf(term);
  while (position !== -1) {
    count += 1;
    position = value.indexOf(term, position + term.length);
  }
  return count;
}

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

function trimSnippet(value: string, maxChars: number): string {
  const compact = value.trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}\n...`;
}
