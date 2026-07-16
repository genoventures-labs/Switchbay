import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { homedir } from "node:os";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

export function resolveWebDist(): string {
  const candidates = [join(import.meta.dir, "..", "..", "web", "dist"), join(process.cwd(), "web", "dist"), join(import.meta.dir, "..", "web", "dist")];
  const found = candidates.find((path) => existsSync(join(path, "index.html")));
  if (!found) throw new Error("The visual workspace is not built. Run `bun run web:build` and try again.");
  return found;
}

export function startWebWorkspaceServer() {
  const root = resolveWebDist();
  const api = Bun.env.SWITCHBAY_API_URL ?? "http://127.0.0.1:7349";
  const token = readApiToken();
  return Bun.serve({
    hostname: Bun.env.SWITCHBAY_WEB_HOST ?? "127.0.0.1",
    port: Number(Bun.env.SWITCHBAY_WEB_PORT ?? 4173),
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/switchbay-health") return Response.json({ ok: true, service: "switchbay-web" });
      if (url.pathname.startsWith("/switchbay-api")) {
        const upstream = new URL(url.pathname.slice("/switchbay-api".length) || "/", api);
        upstream.search = url.search;
        const headers = new Headers(request.headers);
        if (token) headers.set("authorization", `Bearer ${token}`);
        headers.delete("host");
        return fetch(upstream, { method: request.method, headers, body: request.body, redirect: "manual" });
      }
      const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
      const requested = join(root, relative || "index.html");
      const filePath = requested.startsWith(root) && existsSync(requested) ? requested : join(root, "index.html");
      return new Response(Bun.file(filePath), { headers: { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" } });
    },
  });
}

function readApiToken(): string {
  const direct = Bun.env.SWITCHBAY_API_TOKEN?.trim();
  if (direct) return direct;
  const path = Bun.env.SWITCHBAY_API_TOKEN_FILE?.trim() || join(homedir(), ".switchbay", "api-token");
  try { return readFileSync(path, "utf8").trim(); } catch { return ""; }
}
