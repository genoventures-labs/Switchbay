import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describeKnowledgeIndex, refreshKnowledgeIndex, searchKnowledgeIndex } from "../knowledge/store";
import { describeMemory, refreshMemory } from "../memory/store";
import { listSessions } from "../session/persistence";
import { describeLatestTrace } from "../trace/store";
import { runSwitchbayTurn } from "./service";
import { approve, cancelApproval, getApproval } from "./approvals";

let turnQueue: Promise<void> = Promise.resolve();
let queueDepth = 0;
const activeRequests = new Map<string, AbortController>();

export type ServeOptions = { hostname?: string; port?: number };

export function createApiHandler(options: { token?: string; runTurn?: typeof runSwitchbayTurn } = {}) {
  const token = options.token ?? apiToken();
  const runTurn = options.runTurn ?? runSwitchbayTurn;
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/health" && token && !authorized(req, token)) return fail("Unauthorized", 401, "unauthorized");
    try {
      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "switchbay", version: "1.6.4" });
      if (req.method === "GET" && url.pathname === "/v1/capabilities") return json({ apiVersion: "1", features: ["turns", "streaming", "cancellation", "sessions", "approvals", "memory", "knowledge", "traces"], streaming: "sse" });
      if (req.method === "GET" && url.pathname === "/v1/status") return json({ ok: true, apiVersion: "1", queueDepth, activeRequests: activeRequests.size });
      if (req.method === "POST" && url.pathname === "/v1/turn") {
        const body = await readBody(req);
        if (typeof body.input !== "string" || !body.input.trim()) return fail("input is required", 400, "bad_request");
        if (body.workspace !== undefined) await requireWorkspace(body.workspace);
        const requestId = crypto.randomUUID();
        const controller = new AbortController();
        activeRequests.set(requestId, controller);
        try { return json(await enqueue(() => runTurn(body as any, { requestId, signal: controller.signal }))); }
        finally { activeRequests.delete(requestId); }
      }
      if (req.method === "POST" && url.pathname === "/v1/turn/stream") return streamTurn(req, runTurn);
      const cancelMatch = url.pathname.match(/^\/v1\/requests\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch?.[1]) { const found = activeRequests.get(cancelMatch[1]); if (!found) return fail("Request not found", 404, "request_not_found"); found.abort(); return json({ requestId: cancelMatch[1], cancelled: true }); }
      const approvalMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/approval(?:\/(approve|cancel))?$/);
      if (approvalMatch?.[1]) {
        const id = decodeURIComponent(approvalMatch[1]);
        if (req.method === "GET" && !approvalMatch[2]) return json(await getApproval(id));
        if (req.method === "POST" && approvalMatch[2]) { const body = await readBody(req); if (typeof body.approvalId !== "string") return fail("approvalId is required", 400, "bad_request"); if (approvalMatch[2] === "approve") return json(await enqueue(() => approve(id, body.approvalId))); return json(await enqueue(() => cancelApproval(id, body.approvalId))); }
      }
      if (req.method === "GET" && url.pathname === "/v1/sessions") return json({ sessions: await listSessions({ clientId: url.searchParams.get("clientId") ?? undefined, workspace: url.searchParams.get("workspace") ?? undefined }) });
      const cwd = await workspaceFrom(url.searchParams.get("workspace"));
      if (req.method === "GET" && url.pathname === "/v1/memory") return json({ content: await describeMemory(cwd) });
      if (req.method === "POST" && url.pathname === "/v1/memory/refresh") { const body = await readBody(req, true); return json({ content: await refreshMemory(await workspaceFrom(body.workspace)) }); }
      if (req.method === "GET" && url.pathname === "/v1/knowledge") return json({ content: await describeKnowledgeIndex(cwd) });
      if (req.method === "POST" && url.pathname === "/v1/knowledge/refresh") { const body = await readBody(req, true); return json(await refreshKnowledgeIndex(await workspaceFrom(body.workspace))); }
      if (req.method === "GET" && url.pathname === "/v1/knowledge/search") { const q = url.searchParams.get("q")?.trim(); if (!q) return fail("q is required", 400, "bad_request"); return json({ results: await searchKnowledgeIndex(q, cwd, 10) }); }
      if (req.method === "GET" && url.pathname === "/v1/trace/latest") return json({ content: await describeLatestTrace(cwd) });
      return fail("Not found", 404, "not_found");
    } catch (error) {
      if (error instanceof SyntaxError) return fail("Request body must be valid JSON", 400, "bad_request");
      const message = error instanceof Error ? error.message : String(error);
      const explicitCode = typeof (error as any)?.code === "string" ? (error as any).code : null;
      if (explicitCode) return fail(message, explicitCode === "session_not_found" || explicitCode === "no_pending_approval" ? 404 : explicitCode === "approval_mismatch" || explicitCode === "session_scope_mismatch" ? 409 : 400, explicitCode);
      if ((error as any)?.name === "AbortError") return fail("Turn cancelled", 499, "cancelled");
      const badRequest = /input is required|workspace|lane/i.test(message);
      return fail(message, badRequest ? 400 : 500, badRequest ? "bad_request" : "internal_error");
    }
  };
}

export function startApiServer(options: ServeOptions = {}) {
  const hostname = options.hostname ?? Bun.env.SWITCHBAY_API_HOST?.trim() ?? "127.0.0.1";
  const port = options.port ?? Number(Bun.env.SWITCHBAY_API_PORT ?? 7349);
  if (!isLoopback(hostname) && !apiToken()) throw new Error("An API token is required when binding beyond localhost");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SWITCHBAY_API_PORT must be a valid port");
  return Bun.serve({ hostname, port, fetch: createApiHandler() });
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> { queueDepth++; const run = async () => { try { return await fn(); } finally { queueDepth--; } }; const next = turnQueue.then(run, run); turnQueue = next.then(() => undefined, () => undefined); return next; }
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "cache-control": "no-store" } }); }
function fail(message: string, status: number, code: string) { return json({ error: { message, code } }, status); }
async function readBody(req: Request, optional = false): Promise<Record<string, any>> { if (optional && req.body === null) return {}; const body = await req.json(); return body && typeof body === "object" && !Array.isArray(body) ? body : {}; }
async function workspaceFrom(value: unknown): Promise<string> { const cwd = resolve(typeof value === "string" && value.trim() ? value : process.cwd()); await requireWorkspace(cwd); return cwd; }
async function requireWorkspace(value: unknown): Promise<void> { if (typeof value !== "string" || !value.trim()) throw new Error("workspace must be a directory path"); const info = await stat(resolve(value)).catch(() => null); if (!info?.isDirectory()) throw new Error(`workspace is not a directory: ${value}`); }
function authorized(req: Request, token: string) { const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""; const a = Buffer.from(supplied); const b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b); }
function isLoopback(host: string) { return host === "127.0.0.1" || host === "localhost" || host === "::1"; }
function apiToken(): string {
  const direct = Bun.env.SWITCHBAY_API_TOKEN?.trim();
  if (direct) return direct;
  const path = Bun.env.SWITCHBAY_API_TOKEN_FILE?.trim();
  if (!path) return "";
  try { return readFileSync(path, "utf8").trim(); } catch { throw new Error(`Unable to read SWITCHBAY_API_TOKEN_FILE: ${path}`); }
}

function streamTurn(req: Request, runTurn: typeof runSwitchbayTurn): Response {
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(stream) {
      const send = (event: string, data: unknown) => stream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("request", { requestId });
      try {
        const input = await readBody(req);
        if (typeof input.input !== "string" || !input.input.trim()) throw Object.assign(new Error("input is required"), { code: "bad_request" });
        const result = await enqueue(() => runTurn(input as any, { requestId, signal: controller.signal, onToken: token => send("token", { token }), onStep: step => send("step", { step }) }));
        send("done", result);
      } catch (error) { send("error", { message: error instanceof Error ? error.message : String(error), code: (error as any)?.name === "AbortError" ? "cancelled" : (error as any)?.code ?? "internal_error" }); }
      finally { activeRequests.delete(requestId); stream.close(); }
    },
    cancel() { controller.abort(); activeRequests.delete(requestId); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-switchbay-request-id": requestId } });
}
