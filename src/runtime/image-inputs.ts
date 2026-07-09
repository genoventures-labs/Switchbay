import path from "node:path";
import type { ChatMessage } from "./types";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function containsImageReferenceText(text: string): boolean {
  return extractImageReferences(text).length > 0;
}

export async function prepareOpenAiVisionMessages(messages: ChatMessage[], cwd = process.cwd()): Promise<ChatMessage[]> {
  const prepared: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content !== "string") {
      prepared.push(message);
      continue;
    }

    const refs = extractImageReferences(message.content);
    if (!refs.length) {
      prepared.push(message);
      continue;
    }

    const parts: OpenAiContentPart[] = [{ type: "text", text: message.content }];
    for (const ref of refs) {
      const imageUrl = await toImageUrl(ref, cwd);
      if (imageUrl) parts.push({ type: "image_url", image_url: { url: imageUrl } });
    }

    prepared.push(parts.length > 1 ? { ...message, content: parts } : message);
  }
  return prepared;
}

function extractImageReferences(text: string): string[] {
  const refs = new Set<string>();

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) {
    const ref = stripTrailingPunctuation(match[0]);
    if (isImageUrl(ref)) refs.add(ref);
  }

  for (const match of text.matchAll(/\bdata:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/gi)) {
    refs.add(match[0]);
  }

  for (const match of text.matchAll(/["'`]([^"'`]+\.(?:png|jpe?g|webp|gif))["'`]/gi)) {
    const ref = match[1]?.trim();
    if (ref) refs.add(ref);
  }

  for (const match of text.matchAll(/(?:^|\s)((?:\.{1,2}\/|\/|~\/)[^\s<>"'`]+\.(?:png|jpe?g|webp|gif))(?:\s|$)/gi)) {
    const ref = stripTrailingPunctuation(match[1] ?? "");
    if (ref) refs.add(ref);
  }

  return [...refs];
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return IMAGE_EXTENSIONS.has(path.extname(url.pathname).toLowerCase());
  } catch {
    return false;
  }
}

async function toImageUrl(ref: string, cwd: string): Promise<string | null> {
  if (/^https?:\/\//i.test(ref) || /^data:image\//i.test(ref)) return ref;

  const resolved = resolveLocalPath(ref, cwd);
  const file = Bun.file(resolved);
  if (!(await file.exists())) return null;
  if (file.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(`Local image is too large for inline vision input: ${resolved}`);
  }

  const mime = mimeForPath(resolved);
  if (!mime) return null;
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${mime};base64,${base64}`;
}

function resolveLocalPath(ref: string, cwd: string): string {
  if (ref.startsWith("~/")) {
    return path.join(Bun.env.HOME ?? process.cwd(), ref.slice(2));
  }
  return path.isAbsolute(ref) ? ref : path.resolve(cwd, ref);
}

function mimeForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}
