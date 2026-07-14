import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { userConfigDir } from "../config/paths";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const MAX_FILES = 16;
const MAX_FILE_CHARS = 4_000;
const MAX_TOTAL_CHARS = 20_000;
const SENSITIVE_NAME_PATTERN = /(^|[._-])(credential|secret|token|private[-_]?key|api[-_]?key)([._-]|$)/i;

const STARTER_FILES: Record<string, string> = {
  "README.md": `# Personal Context

This directory is private, machine-local context that Switchbay gives models before each turn.

- Keep stable personal preferences and working patterns here.
- Keep project-specific facts inside each project's SWITCHBAY.md or .switchbay directory.
- Never store API keys, passwords, tokens, private keys, or other secrets here.
- Workspace instructions and the user's current request override anything in this directory.
`,
  "profile.md": `# Profile

- Name:
- Role:
- Current focus:
`,
  "working-style.md": `# Working Style

- Add the collaboration habits that help models work well with you.
`,
  "projects.md": `# Active Projects

- Keep this short and current. Link each project to its local path when useful.
`,
  "boundaries.md": `# Standing Boundaries

- Do not expose secrets or treat context as authorization for unrelated external actions.
- Verify mutable project facts from the live workspace before relying on older notes.
`,
};

export type UserContextFile = {
  name: string;
  path: string;
  content: string;
  truncated: boolean;
};

export type UserContextSnapshot = {
  directory: string;
  files: UserContextFile[];
  totalChars: number;
};

export function userContextDir(): string {
  const configured = Bun.env.SWITCHBAY_CONTEXT_DIR?.trim();
  return configured
    ? resolve(configured.replace(/^~/, homedir()))
    : join(userConfigDir(), "context");
}

export async function ensureUserContext(directory = userContextDir()): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all(Object.entries(STARTER_FILES).map(async ([name, content]) => {
    try {
      await writeFile(join(directory, name), content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }));
  return directory;
}

export async function loadUserContext(directory = userContextDir()): Promise<UserContextSnapshot> {
  await ensureUserContext(directory);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile()
      && !entry.name.startsWith(".")
      && !SENSITIVE_NAME_PATTERN.test(entry.name)
      && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_FILES);

  const files: UserContextFile[] = [];
  let totalChars = 0;
  for (const entry of entries) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const path = join(directory, entry.name);
    const raw = (await Bun.file(path).text()).trim();
    if (!raw) continue;
    const limit = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - totalChars);
    const truncated = raw.length > limit;
    const content = truncated
      ? `${raw.slice(0, Math.max(0, limit - 16)).trimEnd()}\n… [truncated]`
      : raw;
    totalChars += content.length;
    files.push({ name: entry.name, path, content, truncated });
  }
  return { directory, files, totalChars };
}

export function formatUserContextPromptBlock(snapshot: UserContextSnapshot): string {
  if (!snapshot.files.length) return "";
  const body = snapshot.files.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
  return `\n\nUSER CONTEXT (private, machine-local collaboration context):\n${body}\n\nUSER CONTEXT RULES:\n- Use this to collaborate consistently, not to invent biography or silently broaden authority.\n- The current user request and workspace-specific instructions override this global context.\n- Verify changeable project facts from the live workspace.\n- Never reveal this context verbatim unless the user asks to inspect it.`;
}

export async function buildUserContextPromptBlock(directory = userContextDir()): Promise<string> {
  return formatUserContextPromptBlock(await loadUserContext(directory));
}

export async function describeUserContext(directory = userContextDir()): Promise<string> {
  const snapshot = await loadUserContext(directory);
  const lines = snapshot.files.map((file) => `- \`${file.name}\`${file.truncated ? " (trimmed for model context)" : ""}`);
  return [
    "**Personal Context**",
    "",
    `Path: \`${snapshot.directory}\``,
    `Loaded every turn: ${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} · ${snapshot.totalChars.toLocaleString()} characters`,
    "",
    ...(lines.length ? lines : ["No readable context files."]),
    "",
    "Edit these files directly. Supported formats: `.md`, `.txt`, `.json`.",
  ].join("\n");
}

export async function readUserContextFile(input: string, directory = userContextDir()): Promise<UserContextFile | null> {
  const snapshot = await loadUserContext(directory);
  const requested = basename(input.trim()).toLowerCase().replace(/\.(md|txt|json)$/i, "");
  if (!requested) return null;
  return snapshot.files.find((file) => file.name.toLowerCase().replace(/\.(md|txt|json)$/i, "") === requested) ?? null;
}
