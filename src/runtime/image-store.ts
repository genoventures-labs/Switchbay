import { join, resolve, extname } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export type ImageEntry = {
  id: string;
  path: string;
  hash: string;
  addedAt: string;
  size: number;
  format?: string;
  tags?: string[];
  note?: string;
};

export type ImageManifest = {
  version: 1;
  entries: ImageEntry[];
};

export function getImageStoreDir(): string {
  return join(homedir(), ".switchbay", "images");
}

function getManifestPath(): string {
  return join(getImageStoreDir(), "manifest.json");
}

export async function loadImageManifest(): Promise<ImageManifest> {
  const file = Bun.file(getManifestPath());
  if (!(await file.exists())) return { version: 1, entries: [] };
  try {
    return (await file.json()) as ImageManifest;
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function saveImageManifest(manifest: ImageManifest): Promise<void> {
  mkdirSync(getImageStoreDir(), { recursive: true });
  await Bun.write(getManifestPath(), JSON.stringify(manifest, null, 2));
}

async function hashFile(filePath: string): Promise<string> {
  const data = await Bun.file(filePath).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function addImageToStore(
  imagePath: string,
  meta?: { tags?: string[]; note?: string },
): Promise<{ entry: ImageEntry; isNew: boolean }> {
  const abs = resolve(imagePath);
  const file = Bun.file(abs);
  if (!(await file.exists())) throw new Error(`Image not found: ${abs}`);
  const size = file.size;
  const hash = await hashFile(abs);
  const manifest = await loadImageManifest();
  const existing = manifest.entries.find((e) => e.hash === hash);
  if (existing) {
    if (existing.path !== abs) {
      existing.path = abs;
      await saveImageManifest(manifest);
    }
    return { entry: existing, isNew: false };
  }
  const id = hash.slice(0, 12);
  const format = extname(abs).slice(1).toLowerCase() || undefined;
  const entry: ImageEntry = {
    id,
    path: abs,
    hash,
    addedAt: new Date().toISOString(),
    size,
    format,
    tags: meta?.tags,
    note: meta?.note,
  };
  manifest.entries.unshift(entry);
  await saveImageManifest(manifest);
  return { entry, isNew: true };
}

export async function listImages(): Promise<ImageEntry[]> {
  const manifest = await loadImageManifest();
  return manifest.entries;
}

export async function removeImageById(id: string): Promise<boolean> {
  const manifest = await loadImageManifest();
  const before = manifest.entries.length;
  manifest.entries = manifest.entries.filter(
    (e) => e.id !== id && !e.hash.startsWith(id),
  );
  if (manifest.entries.length < before) {
    await saveImageManifest(manifest);
    return true;
  }
  return false;
}

export function formatImageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
