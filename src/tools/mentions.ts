import path from "node:path";
import fs from "node:fs";
import { readWorkspaceFile } from "./files";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".switchbay", "dist", "build", ".next",
  ".nuxt", "coverage", ".cache", "__pycache__", ".venv",
]);

const MAX_FILE_SIZE = 64 * 1024; // 64KB cap per file

export type MentionCandidate = {
  label: string;   // display label e.g. "src/auth.ts"
  value: string;   // full relative path
  isDir: boolean;
};

/**
 * List files and directories under cwd for the @ picker.
 * Returns paths relative to cwd, sorted: dirs first, then files.
 */
export async function listMentionCandidates(
  cwd: string,
  partial = "",
): Promise<MentionCandidate[]> {
  const results: MentionCandidate[] = [];
  const lowerPartial = partial.toLowerCase();

  await walk(cwd, cwd, results, 0);

  const filtered = lowerPartial
    ? results.filter((c) => c.value.toLowerCase().includes(lowerPartial))
    : results;

  return filtered.slice(0, 40);
}

async function walk(
  root: string,
  dir: string,
  out: MentionCandidate[],
  depth: number,
): Promise<void> {
  if (depth > 4) return;

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    const glob = new Bun.Glob("*");
    const rawEntries = await Array.fromAsync(glob.scan({ cwd: dir, onlyFiles: false }));
    entries = rawEntries.map((name) => ({
      name,
      isDirectory: () => {
        try {
          return fs.statSync(path.join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      },
    }));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);
    const isDir = entry.isDirectory();

    out.push({ label: relPath, value: relPath, isDir });

    if (isDir && depth < 3) {
      await walk(root, fullPath, out, depth + 1);
    }
  }
}

/**
 * Read the content of a @mention target (file or directory).
 * For directories, reads all files inside up to a combined size cap.
 */
export async function resolveMentionContent(
  mentionPath: string,
  cwd: string,
): Promise<string> {
  const fullPath = path.resolve(cwd, mentionPath);

  let isDir = false;
  try {
    isDir = fs.statSync(fullPath).isDirectory();
  } catch {
    // treat as file
  }

  if (isDir) {
    return resolveDirContent(fullPath, mentionPath, cwd);
  }

  try {
    const file = await readWorkspaceFile(mentionPath, cwd);
    const truncated = file.content.length > MAX_FILE_SIZE
      ? file.content.slice(0, MAX_FILE_SIZE) + "\n... (truncated)"
      : file.content;
    return `### @${mentionPath}\n\`\`\`\n${truncated}\n\`\`\``;
  } catch (err) {
    return `### @${mentionPath}\n(could not read: ${err instanceof Error ? err.message : String(err)})`;
  }
}

async function resolveDirContent(
  fullDirPath: string,
  relDirPath: string,
  cwd: string,
): Promise<string> {
  const files: MentionCandidate[] = [];
  await walk(fullDirPath, fullDirPath, files, 0);

  const fileEntries = files.filter((f) => !f.isDir).slice(0, 20);
  const parts: string[] = [`### @${relDirPath}/`];
  let totalSize = 0;

  for (const f of fileEntries) {
    if (totalSize > MAX_FILE_SIZE) {
      parts.push(`... (size cap reached, ${fileEntries.length - parts.length + 1} files omitted)`);
      break;
    }
    try {
      const absPath = path.join(fullDirPath, f.value);
      const relPath = path.join(relDirPath, f.value);
      const content = await Bun.file(absPath).text();
      const snippet = content.length > 8192 ? content.slice(0, 8192) + "\n... (truncated)" : content;
      parts.push(`#### ${relPath}\n\`\`\`\n${snippet}\n\`\`\``);
      totalSize += snippet.length;
    } catch {
      // skip unreadable files
    }
  }

  return parts.join("\n\n");
}

/**
 * Parse @mentions out of a query string.
 * Returns the mentions found and the query with mentions stripped.
 */
export function parseMentions(query: string): {
  mentions: string[];
  cleanQuery: string;
} {
  const mentionPattern = /@([\w./\-]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(query)) !== null) {
    if (match[1]) mentions.push(match[1]);
  }

  const cleanQuery = query.replace(/@[\w./\-]+/g, "").replace(/\s+/g, " ").trim();
  return { mentions, cleanQuery };
}
