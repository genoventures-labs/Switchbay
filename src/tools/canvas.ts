import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export type CanvasDoc = {
  name: string;
  file: string;
  size: number;
  updatedAt: string;
};

export type CanvasEditOp = "replace_all" | "append" | "prepend" | "insert_after";

function canvasDir(workspace: string): string {
  return join(workspace, ".switchbay", "canvas");
}

function safeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-").toLowerCase().slice(0, 80);
}

export async function listCanvasDocs(workspace: string): Promise<CanvasDoc[]> {
  const dir = canvasDir(workspace);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const docs: CanvasDoc[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (!info) continue;
    docs.push({
      name: basename(entry.name, ".md").replace(/-/g, " "),
      file: entry.name,
      size: info.size,
      updatedAt: info.mtime.toISOString(),
    });
  }
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readCanvasDoc(workspace: string, file: string): Promise<string> {
  const path = safeCanvasPath(workspace, file);
  return readFile(path, "utf8").catch(() => "");
}

export async function writeCanvasDoc(workspace: string, file: string, content: string): Promise<void> {
  const dir = canvasDir(workspace);
  await mkdir(dir, { recursive: true });
  const path = safeCanvasPath(workspace, file);
  await writeFile(path, content, "utf8");
}

export async function createCanvasDoc(workspace: string, name: string, content = ""): Promise<string> {
  const dir = canvasDir(workspace);
  await mkdir(dir, { recursive: true });
  const slug = safeName(name) || "untitled";
  let file = `${slug}.md`;
  let attempt = 1;
  while (true) {
    try {
      await stat(join(dir, file));
      file = `${slug}-${++attempt}.md`;
    } catch {
      break;
    }
  }
  await writeFile(join(dir, file), content, "utf8");
  return file;
}

export async function deleteCanvasDoc(workspace: string, file: string): Promise<void> {
  const dir = canvasDir(workspace);
  const safe = basename(resolve(dir, file));
  await rm(join(dir, safe));
}

export async function renameCanvasDoc(workspace: string, file: string, newName: string): Promise<string> {
  const dir = canvasDir(workspace);
  const safe = basename(resolve(dir, file));
  const slug = safeName(newName) || "untitled";
  let newFile = `${slug}.md`;
  let attempt = 1;
  while (true) {
    try {
      await stat(join(dir, newFile));
      newFile = `${slug}-${++attempt}.md`;
    } catch {
      break;
    }
  }
  await rename(join(dir, safe), join(dir, newFile));
  return newFile;
}

export async function editCanvasDoc(
  workspace: string,
  file: string,
  op: CanvasEditOp,
  content: string,
  anchor?: string,
): Promise<string> {
  const existing = await readCanvasDoc(workspace, file);
  let next: string;
  if (op === "replace_all") {
    next = content;
  } else if (op === "append") {
    next = existing ? `${existing.trimEnd()}\n\n${content}` : content;
  } else if (op === "prepend") {
    next = existing ? `${content}\n\n${existing.trimStart()}` : content;
  } else if (op === "insert_after") {
    if (!anchor) throw new Error("insert_after requires an anchor string.");
    const idx = existing.indexOf(anchor);
    if (idx === -1) throw new Error(`Anchor not found in document: "${anchor}"`);
    const insertAt = idx + anchor.length;
    next = `${existing.slice(0, insertAt)}\n\n${content}${existing.slice(insertAt)}`;
  } else {
    throw new Error(`Unknown canvas op: ${op}`);
  }
  await writeCanvasDoc(workspace, file, next);
  return next;
}

function safeCanvasPath(workspace: string, file: string): string {
  const dir = canvasDir(workspace);
  const resolved = resolve(dir, basename(file));
  if (!resolved.startsWith(dir)) throw new Error("Invalid canvas file path.");
  return resolved;
}
