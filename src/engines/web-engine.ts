type WebAction = "fetch" | "headers" | "links";

const MAX_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 12_000;

async function main() {
  const [action, ...args] = Bun.argv.slice(2);
  const url = readFlag(args, "--url");

  if (!isWebAction(action)) {
    throw new Error("Usage: bun web-engine.ts <fetch|headers|links> --url <https://example.com>");
  }
  if (!url) {
    throw new Error("Web Engine requires --url.");
  }

  const target = parsePublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
        "user-agent": "Switchbay-Web-Engine/1.0 (+https://github.com/genoventures-labs/Switchbay)",
      },
    });

    if (action === "headers") {
      printHeaders(target, response);
      return;
    }

    const contentType = response.headers.get("content-type") ?? "unknown";
    const bytes = await limitedBytes(response);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    if (action === "links") {
      printLinks(target, response, text);
      return;
    }

    printFetch(target, response, contentType, text, bytes.length);
  } finally {
    clearTimeout(timer);
  }
}

function isWebAction(value: string | undefined): value is WebAction {
  return value === "fetch" || value === "headers" || value === "links";
}

function readFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? "" : "";
}

function parsePublicUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Web Engine only supports http and https URLs.");
  }
  if (!Bun.env.SWITCHBAY_WEB_ALLOW_PRIVATE && isPrivateHost(parsed.hostname)) {
    throw new Error("Blocked private or local host. Set SWITCHBAY_WEB_ALLOW_PRIVATE=1 only if you intentionally want Web Engine to read internal addresses.");
  }
  return parsed;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }

  return false;
}

async function limitedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = MAX_BYTES - total;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    total += Math.min(value.length, remaining);
    if (value.length > remaining) break;
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function printHeaders(url: URL, response: Response) {
  const lines = [
    `URL: ${url.href}`,
    `Status: ${response.status} ${response.statusText}`,
    "",
    ...[...response.headers.entries()].map(([key, value]) => `${key}: ${value}`),
  ];
  console.log(lines.join("\n"));
}

function printFetch(url: URL, response: Response, contentType: string, text: string, bytes: number) {
  const readable = contentType.includes("html") ? htmlToText(text) : text.trim();
  const clipped = readable.length > 18_000 ? `${readable.slice(0, 18_000)}\n\n[truncated]` : readable;
  console.log([
    `URL: ${url.href}`,
    `Status: ${response.status} ${response.statusText}`,
    `Content-Type: ${contentType}`,
    `Bytes read: ${bytes}${bytes >= MAX_BYTES ? " (limit reached)" : ""}`,
    "",
    clipped || "(no readable text)",
  ].join("\n"));
}

function printLinks(url: URL, response: Response, html: string) {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try {
        return {
          href: new URL(decodeHtml(match[1] ?? ""), url).href,
          text: htmlToText(match[2] ?? "").replace(/\s+/g, " ").trim(),
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { href: string; text: string } => Boolean(entry))
    .filter((entry, index, all) => all.findIndex((other) => other.href === entry.href) === index)
    .slice(0, 80);

  console.log([
    `URL: ${url.href}`,
    `Status: ${response.status} ${response.statusText}`,
    "",
    links.map((entry) => `- ${entry.text ? `${entry.text} - ` : ""}${entry.href}`).join("\n") || "No links found.",
  ].join("\n"));
}

function htmlToText(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
