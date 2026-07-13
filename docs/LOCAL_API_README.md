# Switchbay Local API

This document describes the local HTTP API that lets other apps use Switchbay without shelling out to the CLI/TUI. The first implementation ships with `switchbay serve`, serialized agent turns, explicit workspace selection, loopback-only defaults, and optional bearer authentication.

The original design notes remain below as implementation context. The source of truth for the current contract is `src/api/server.ts` and its tests.

## Goal

Add a local-only server command:

```bash
switchbay serve
```

The server should expose Switchbay's existing turn loop, workspace context, memory, knowledge, trace, and session helpers over HTTP.

Primary use case: desktop apps, local web apps, automations, or editor integrations can call Switchbay as a local agent service.

## Current State

Switchbay is currently CLI/TUI-first:

- `switchbay` launches the Ink TUI.
- `switchbay "query"` runs a one-shot turn.
- `switchbay memory`, `switchbay knowledge`, `switchbay trace`, etc. expose helper commands.
- Agent execution already lives in reusable modules under `src/`.

The main implementation is currently wired from `index.tsx`:

- CLI parsing: `src/cli/args.ts`
- runtime client creation: `src/runtime/client.ts`
- workspace snapshot: `src/session/workspace.ts`
- turn building/execution: `src/agent/loop.ts`
- session persistence: `src/session/persistence.ts`
- memory: `src/memory/store.ts`
- knowledge: `src/knowledge/store.ts`
- trace: `src/trace/store.ts`

The main thing missing is a clean reusable service function and an HTTP wrapper.

## Recommended Architecture

Do **not** import `index.tsx` into the API server. `index.tsx` boots the CLI/TUI immediately.

Instead:

1. Extract the one-shot CLI turn logic from `index.tsx` into a reusable module.
2. Add a Bun HTTP server that calls that module.
3. Add `serve` as a CLI subcommand.
4. Keep the server bound to `127.0.0.1` by default.
5. Add optional bearer-token auth with `SWITCHBAY_API_TOKEN`.

Suggested new files:

```text
src/api/types.ts
src/api/service.ts
src/api/server.ts
src/api/server.test.ts
```

Suggested changed files:

```text
src/cli/args.ts
index.tsx
README.md
```

## Step 1: Add a Reusable Turn Service

Create `src/api/service.ts` with a function like:

```ts
import { getToolMode, normalizeRuntimeLane, type RuntimeLane } from "../config/env";
import { createRuntimeClient } from "../runtime/client";
import { buildTurn, executeTurn, extractAssistantText, refreshWorkspace, synthesizeAssistantFallback } from "../agent/loop";
import { resolveAgentPolicy } from "../agent/policy";
import { createInitialSessionState } from "../agent/turn-state";
import { loadPersistedSession, savePersistedSession } from "../session/persistence";
import { saveTraceRecord } from "../trace/store";

export type RunSwitchbayTurnInput = {
  input: string;
  lane?: string | null;
  mode?: string;
  profile?: string;
  surface?: string;
  sessionId?: string | null;
  newSession?: boolean;
  cwd?: string;
};

export type RunSwitchbayTurnOutput = {
  sessionId: string;
  content: string;
  lane: RuntimeLane;
  toolExecutions: Array<{
    tool: string;
    summary: string;
    ok: boolean;
    changedFile?: string;
  }>;
  traceSaved: boolean;
  workspace: {
    cwd: string;
    repoRoot: string | null;
    branch: string | null;
    dirtyFiles: string[];
  } | null;
};

export async function runSwitchbayTurn(input: RunSwitchbayTurnInput): Promise<RunSwitchbayTurnOutput> {
  if (!input.input?.trim()) {
    throw new Error("input is required");
  }

  const originalCwd = process.cwd();
  if (input.cwd) {
    process.chdir(input.cwd);
  }

  try {
    const runtimeLane = normalizeRuntimeLane(input.lane);
    const toolMode = getToolMode();
    const client = createRuntimeClient(runtimeLane);
    const workspace = await refreshWorkspace();

    let state = await loadPersistedSession(input.sessionId || undefined);
    if (!state || input.newSession) {
      const policy = resolveAgentPolicy({
        mode: input.mode ?? "build",
        profile: input.profile ?? "switchbay",
      });
      state = createInitialSessionState({
        mode: policy.mode,
        profile: input.profile ?? "switchbay",
        resolvedProfile: policy.runtimeProfile,
        surface: input.surface ?? "dev",
      });
    }

    const turn = await buildTurn({
      input: input.input,
      mode: state.mode,
      profile: state.requestedProfile,
      previousObjective: state.currentObjective,
      transcript: state.conversation,
      workspace,
      runtimeLane,
      toolMode,
    });

    const executedTurn = await executeTurn({
      client,
      sessionId: state.sessionId,
      surface: state.surface,
      turn,
      workspace,
    });

    const content =
      extractAssistantText(executedTurn.response) ||
      synthesizeAssistantFallback(input.input, executedTurn.toolExecutions, workspace);

    let traceSaved = false;
    if (content) {
      await saveTraceRecord({
        assistantContent: content,
        cwd: workspace?.cwd ?? process.cwd(),
        executedTurn,
        runtimeLane,
        toolMode,
        sessionId: state.sessionId,
        turn,
        userPrompt: input.input,
        workspace,
      });
      traceSaved = true;
    }

    state.conversation.push({ role: "user", content: input.input });
    if (content) state.conversation.push({ role: "assistant", content });
    state.updatedAt = Date.now();
    await savePersistedSession(state);

    return {
      sessionId: state.sessionId,
      content,
      lane: runtimeLane,
      traceSaved,
      toolExecutions: executedTurn.toolExecutions.map((execution) => ({
        tool: execution.tool,
        summary: execution.summary,
        ok: execution.ok,
        changedFile: execution.changedFile,
      })),
      workspace: workspace
        ? {
            cwd: workspace.cwd,
            repoRoot: workspace.repoRoot,
            branch: workspace.branch,
            dirtyFiles: workspace.dirtyFiles,
          }
        : null,
    };
  } finally {
    if (input.cwd) {
      process.chdir(originalCwd);
    }
  }
}
```

### Important Service Notes

- `process.chdir()` is acceptable for a first local-only implementation, but it is global process state.
- For concurrent requests, either:
  - serialize turn requests with a simple queue, or
  - refactor deeper functions to accept `cwd` everywhere instead of relying on `process.cwd()`.
- The first version should probably process one turn at a time.
- Return JSON only. Do not include ANSI terminal formatting.

## Step 2: Add API Types

Create `src/api/types.ts`:

```ts
export type ApiErrorResponse = {
  error: {
    message: string;
    code: string;
  };
};

export type TurnRequest = {
  input: string;
  workspace?: string;
  lane?: "cloud" | "local" | "mcp" | "cloud-mcp" | "local-mcp";
  mode?: string;
  profile?: string;
  surface?: string;
  sessionId?: string;
  newSession?: boolean;
};
```

## Step 3: Add the Local HTTP Server

Create `src/api/server.ts` using `Bun.serve`.

Suggested routes:

```text
GET  /health
POST /v1/turn
GET  /v1/sessions
GET  /v1/memory
POST /v1/memory/refresh
GET  /v1/knowledge
POST /v1/knowledge/refresh
GET  /v1/knowledge/search?q=...
GET  /v1/trace/latest
GET  /v1/trace/export
```

Minimal server shape:

```ts
import { runSwitchbayTurn } from "./service";
import { listSessions } from "../session/persistence";
import { describeMemory, refreshMemory } from "../memory/store";
import { describeKnowledgeIndex, refreshKnowledgeIndex, searchKnowledgeIndex } from "../knowledge/store";
import { describeLatestTrace, latestTraceExportPath } from "../trace/store";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 500, code = "internal_error"): Response {
  return json({ error: { message, code } }, status);
}

function isAuthorized(req: Request): boolean {
  const token = Bun.env.SWITCHBAY_API_TOKEN?.trim();
  if (!token) return true;
  return req.headers.get("authorization") === `Bearer ${token}`;
}

export type ServeOptions = {
  hostname?: string;
  port?: number;
};

export function startApiServer(options: ServeOptions = {}) {
  const hostname = options.hostname ?? Bun.env.SWITCHBAY_API_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(Bun.env.SWITCHBAY_API_PORT ?? 7349);

  return Bun.serve({
    hostname,
    port,
    async fetch(req) {
      try {
        if (!isAuthorized(req)) return error("Unauthorized", 401, "unauthorized");

        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/health") {
          return json({ ok: true, service: "switchbay", version: "1.6.4" });
        }

        if (req.method === "POST" && url.pathname === "/v1/turn") {
          const body = await req.json();
          const result = await runSwitchbayTurn({
            input: body.input,
            cwd: body.workspace,
            lane: body.lane,
            mode: body.mode,
            profile: body.profile,
            surface: body.surface,
            sessionId: body.sessionId,
            newSession: body.newSession,
          });
          return json(result);
        }

        if (req.method === "GET" && url.pathname === "/v1/sessions") {
          return json({ sessions: await listSessions() });
        }

        if (req.method === "GET" && url.pathname === "/v1/memory") {
          const cwd = url.searchParams.get("workspace") ?? process.cwd();
          return json({ content: await describeMemory(cwd) });
        }

        if (req.method === "POST" && url.pathname === "/v1/memory/refresh") {
          const body = await req.json().catch(() => ({}));
          const cwd = body.workspace ?? process.cwd();
          return json({ content: await refreshMemory(cwd) });
        }

        if (req.method === "GET" && url.pathname === "/v1/knowledge") {
          const cwd = url.searchParams.get("workspace") ?? process.cwd();
          return json({ content: await describeKnowledgeIndex(cwd) });
        }

        if (req.method === "POST" && url.pathname === "/v1/knowledge/refresh") {
          const body = await req.json().catch(() => ({}));
          const cwd = body.workspace ?? process.cwd();
          const index = await refreshKnowledgeIndex(cwd);
          return json(index);
        }

        if (req.method === "GET" && url.pathname === "/v1/knowledge/search") {
          const cwd = url.searchParams.get("workspace") ?? process.cwd();
          const q = url.searchParams.get("q");
          if (!q) return error("Missing q query parameter", 400, "bad_request");
          return json({ results: await searchKnowledgeIndex(q, cwd, 10) });
        }

        if (req.method === "GET" && url.pathname === "/v1/trace/latest") {
          const cwd = url.searchParams.get("workspace") ?? process.cwd();
          return json({ content: await describeLatestTrace(cwd) });
        }

        if (req.method === "GET" && url.pathname === "/v1/trace/export") {
          const cwd = url.searchParams.get("workspace") ?? process.cwd();
          return json({ path: await latestTraceExportPath(cwd) });
        }

        return error("Not found", 404, "not_found");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return error(message);
      }
    },
  });
}
```

## Step 4: Add `serve` to CLI Args

Update `src/cli/args.ts`.

Add `serve` to the `subcommand` union:

```ts
subcommand:
  | "run"
  | "serve"
  | "update"
  | "version"
  | "help"
  | "engines"
  | "skills"
  | "toolbox"
  | "plugins"
  | "memory"
  | "knowledge"
  | "trace"
  | "mcp";
```

Add parser support:

```ts
} else if (arg === "serve") {
  return {
    surface,
    profile,
    mode,
    lane,
    initialQuery: "",
    hop,
    resume,
    newSession,
    purge,
    subcommand: "serve",
    engineAction: "status",
    toolboxAction: "status",
    toolboxSkill: null,
    memoryAction: "status",
    knowledgeAction: "status",
    knowledgeQuery: null,
    traceAction: "last",
    mcpAction: "status",
  };
}
```

Optionally parse:

```bash
switchbay serve --port 7349 --host 127.0.0.1
```

For the first version, environment variables are enough:

```bash
SWITCHBAY_API_PORT=7349
SWITCHBAY_API_HOST=127.0.0.1
SWITCHBAY_API_TOKEN=optional-token
SWITCHBAY_API_TOKEN_FILE=~/.switchbay/api-token
```

## Step 5: Wire `serve` in `index.tsx`

Add this near the other subcommand branches:

```ts
if (options.subcommand === "serve") {
  const { startApiServer } = await import("./src/api/server");
  const server = startApiServer();
  console.log(`Switchbay API listening on http://${server.hostname}:${server.port}`);
  return;
}
```

Because `Bun.serve()` keeps the process alive, returning from `boot()` is fine.

Also add it to help text:

```text
switchbay serve                  Start local HTTP API server
```

## API Contract

### `GET /health`

Response:

```json
{
  "ok": true,
  "service": "switchbay",
  "version": "1.6.4"
}
```

### `POST /v1/turn`

Request:

```json
{
  "input": "Review this repo and tell me what to build next",
  "workspace": "/Users/cass/Documents/GitHub/Switchbay",
  "lane": "cloud",
  "mode": "build",
  "profile": "switchbay",
  "surface": "dev",
  "sessionId": "optional-existing-session-id",
  "newSession": false
}
```

Response:

```json
{
  "sessionId": "session-id",
  "content": "Assistant response text",
  "lane": "cloud",
  "traceSaved": true,
  "toolExecutions": [
    {
      "tool": "read_file",
      "summary": "Read README.md",
      "ok": true,
      "changedFile": null
    }
  ],
  "workspace": {
    "cwd": "/Users/cass/Documents/GitHub/Switchbay",
    "repoRoot": "/Users/cass/Documents/GitHub/Switchbay",
    "branch": "main",
    "dirtyFiles": []
  }
}
```

Errors:

```json
{
  "error": {
    "message": "input is required",
    "code": "bad_request"
  }
}
```

### `GET /v1/sessions`

Returns persisted sessions from `src/session/persistence.ts`.

### `GET /v1/memory?workspace=/path/to/repo`

Returns the same content as `switchbay memory`.

### `POST /v1/memory/refresh`

Request:

```json
{
  "workspace": "/path/to/repo"
}
```

Returns refreshed operational memory text.

### `GET /v1/knowledge?workspace=/path/to/repo`

Returns the same content as `switchbay knowledge`.

### `POST /v1/knowledge/refresh`

Request:

```json
{
  "workspace": "/path/to/repo"
}
```

Returns knowledge index metadata.

### `GET /v1/knowledge/search?q=query&workspace=/path/to/repo`

Returns sourced workspace snippets.

### `GET /v1/trace/latest?workspace=/path/to/repo`

Returns the latest trace summary.

### `GET /v1/trace/export?workspace=/path/to/repo`

Returns the latest trace file path.

## Example Usage

Start the server:

```bash
switchbay serve
```

Call a turn:

```bash
curl -s http://127.0.0.1:7349/v1/turn \
  -H 'content-type: application/json' \
  -d '{
    "input": "Summarize the current repo state",
    "workspace": "/Users/cass/Documents/GitHub/Switchbay",
    "lane": "cloud",
    "mode": "build",
    "profile": "switchbay"
  }'
```

With auth enabled:

```bash
SWITCHBAY_API_TOKEN="dev-token" switchbay serve
```

```bash
curl -s http://127.0.0.1:7349/v1/turn \
  -H 'authorization: Bearer dev-token' \
  -H 'content-type: application/json' \
  -d '{"input":"Hello Bay"}'
```

## Security Rules

Default behavior should be safe for local development:

- Bind to `127.0.0.1`, not `0.0.0.0`.
- Do not enable CORS by default.
- Support `SWITCHBAY_API_TOKEN` for local apps that want auth.
- Never expose destructive/publishing tool actions without Switchbay's existing approval rules.
- Keep workspace access local-first and consistent with current Switchbay rules.
- Avoid accepting arbitrary remote callbacks or webhooks in the first version.

If a future version supports LAN access, require explicit opt-in:

```bash
SWITCHBAY_API_HOST=0.0.0.0 SWITCHBAY_API_TOKEN=... switchbay serve
```

## Concurrency

First version recommendation: serialize `/v1/turn` requests.

Reason: some current code paths use `process.cwd()`. If two apps call two different workspaces at the same time and the service uses `process.chdir()`, requests can interfere with each other.

Simple queue approach:

```ts
let turnQueue = Promise.resolve();

function enqueueTurn<T>(fn: () => Promise<T>): Promise<T> {
  const next = turnQueue.then(fn, fn);
  turnQueue = next.then(() => undefined, () => undefined);
  return next;
}
```

Then in `/v1/turn`:

```ts
const result = await enqueueTurn(() => runSwitchbayTurn(...));
```

Later improvement: remove `process.chdir()` and pass `cwd` explicitly into all lower-level helpers.

## Streaming Later

The first version can return a normal JSON response.

Later, add:

```text
POST /v1/turn/stream
```

Use Server-Sent Events:

```text
event: token
data: {"token":"hello"}

event: tool
data: {"tool":"read_file","summary":"Read README.md","ok":true}

event: done
data: {"sessionId":"...","content":"final text"}
```

`executeTurn()` already accepts `onToken`, so the core loop is close to streaming-ready.

## Tests

Add focused Bun tests.

Recommended test cases:

1. `parseCliArgs(["bun", "index.tsx", "serve"])` returns `subcommand: "serve"`.
2. `GET /health` returns `{ ok: true }`.
3. Unauthorized request returns `401` when `SWITCHBAY_API_TOKEN` is set.
4. Missing `input` on `/v1/turn` returns `400`.
5. Server route matching returns `404` for unknown paths.

Avoid model-provider calls in unit tests. Mock or isolate `runSwitchbayTurn` when testing HTTP routing.

## Acceptance Checklist

- [ ] `switchbay serve` starts a local server.
- [ ] `GET /health` works.
- [ ] `POST /v1/turn` can run a Switchbay turn and return JSON.
- [ ] Session persistence still works.
- [ ] Trace saving still works.
- [ ] Memory and knowledge helper routes work.
- [ ] `SWITCHBAY_API_TOKEN` protects routes when set.
- [ ] Default host is `127.0.0.1`.
- [ ] `bun test` passes.
- [ ] `bun run build` passes.
- [ ] README/help text mention `switchbay serve`.

## Suggested Implementation Order

1. Add API types.
2. Extract `runSwitchbayTurn()` from `index.tsx` into `src/api/service.ts`.
3. Refactor CLI one-shot mode to call `runSwitchbayTurn()` so CLI and API share one code path.
4. Add `src/api/server.ts` with `/health` first.
5. Add `/v1/turn`.
6. Add memory/knowledge/trace/session routes.
7. Add `serve` to CLI parser and help text.
8. Add focused tests.
9. Run `bun test` and `bun run build`.

## Non-Goals for First Version

- Public cloud-hosted Switchbay API.
- Multi-user auth.
- Browser CORS support by default.
- WebSocket streaming.
- Full MCP server compatibility.
- Remote workspace mounting.

Keep v1 boring: local HTTP, JSON, one turn at a time, existing Switchbay behavior.
