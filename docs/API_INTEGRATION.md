# Integrating Apps with Switchbay

Switchbay can run as a private local agent service and be consumed from Bun, Node.js, TypeScript, desktop apps, editor extensions, and other trusted software on the same Mac. The supported client entry point is:

```ts
import { Switchbay } from "@genoventures/switchbay";
```

The service listens on `http://127.0.0.1:7349` by default. An integration supplies a workspace, a stable client ID, and the service token; Switchbay supplies agent turns, sessions, approvals, memory, knowledge, and traces without requiring the app to launch a shell command for every request.

## 1. Install and run the macOS service

From a Switchbay checkout:

```bash
bun install
switchbay service install
switchbay service status
```

`service install` builds a service snapshot, registers a macOS login agent, creates a private token, and starts the API. It prints the service URL and token path. The defaults are:

```text
URL:   http://127.0.0.1:7349
Token: ~/.switchbay/api-token
```

The token file is created with owner-only permissions. Keep it out of source control and do not copy its contents into browser-delivered JavaScript.

Useful service commands:

```bash
switchbay service status
switchbay service restart
switchbay service install    # rebuild and restart after server-side source changes
switchbay service uninstall
```

Uninstalling preserves the token, sessions, memory, and logs. The login service currently supports macOS only. On other platforms, or while developing the server, run `switchbay serve` directly.

Check that the process is alive:

```bash
curl http://127.0.0.1:7349/health
```

`/health` is intentionally public. All `/v1` routes require the bearer token when the installed service is used.

## 2. Add the client to another app

Install the package when it is available from your configured package registry:

```bash
bun add @genoventures/switchbay
```

For active development against a local Switchbay checkout, link it instead:

```bash
# Run once inside the Switchbay repository
bun link

# Run inside the consuming app
bun link @genoventures/switchbay
```

The package exports an ESM client and TypeScript declarations. Its HTTP client works in Bun and modern Node.js versions that provide `fetch`.

## 3. Create a client

For a trusted local Bun app, read the token at runtime:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { Switchbay } from "@genoventures/switchbay";

const token = (await Bun.file(join(homedir(), ".switchbay/api-token")).text()).trim();

export const bay = new Switchbay({
  baseUrl: "http://127.0.0.1:7349",
  token,
  clientId: "pagetend",
  workspace: "/absolute/path/to/PageTend",
});
```

Use one stable, application-specific `clientId`. It separates that app's session listing and prevents a turn from resuming a session owned by another client. Use an absolute workspace path. A turn can override both values when necessary, but stable constructor defaults are easier to reason about.

Do not expose this client directly to an untrusted renderer or public website. For Electron, Tauri, or a local web UI, keep the token and Switchbay calls in the trusted backend/main process and expose only narrowly scoped application actions to the UI.

Constructor options:

| Option | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:7349` | API origin |
| `token` | none | Bearer token for protected routes |
| `clientId` | `default` | Stable owner for sessions |
| `workspace` | none | Default absolute workspace path |
| `fetch` | `globalThis.fetch` | Optional custom fetch implementation |

## 4. Run an agent turn

```ts
const result = await bay.turn({
  input: "Inspect the current project and identify the highest-priority issue.",
  mode: "build",
  newSession: true,
});

console.log(result.content);
console.log(result.sessionId);
console.log(result.route);          // actual provider/model metadata, when available
console.log(result.toolExecutions); // structured tool summaries
console.log(result.workspace);
```

A successful result includes `requestId`, `sessionId`, `content`, `lane`, `traceSaved`, `toolExecutions`, a workspace snapshot, an optional `pendingApproval`, and optional provider/model route metadata.

To continue the same conversation:

```ts
const followUp = await bay.turn({
  input: "Go deeper on the first issue.",
  sessionId: result.sessionId,
});
```

The service rejects a session resumed under a different `clientId` or workspace. Set `newSession: true` to start fresh. Turn inputs also accept `lane`, `profile`, `surface`, and an `AbortSignal`.

## 5. Stream progress

`turnStream()` consumes Switchbay's server-sent event stream:

```ts
let requestId: string | undefined;
let completed;

for await (const event of bay.turnStream({
  input: "Review this workspace and propose the next change.",
  newSession: true,
})) {
  if (event.event === "request") requestId = event.data.requestId;
  if (event.event === "token") process.stdout.write(event.data.token);
  if (event.event === "step") console.log("\nStep:", event.data.step);
  if (event.event === "done") completed = event.data;
  if (event.event === "error") throw new Error(`${event.data.code}: ${event.data.message}`);
}
```

Event types are `request`, `token`, `step`, `done`, and `error`. The initial `request` event is important: it supplies the request ID before the turn finishes, so the app can offer a working Cancel button.

## 6. Cancel work

Cancel a streamed request using the ID from its first event:

```ts
await bay.cancel(requestId);
```

Or abort the client connection:

```ts
const controller = new AbortController();

const stream = bay.turnStream({
  input: "Perform a long review.",
  signal: controller.signal,
});

controller.abort();
```

Cancellation is best-effort and applies only while the request is active. Cancelling an unknown or already completed request returns `request_not_found`. A non-streaming `turn()` only returns its `requestId` after completion, so use streaming when the UI needs explicit server-side cancellation during execution.

## 7. Sessions and approvals

List sessions scoped to the client's configured workspace and `clientId`:

```ts
const { sessions } = await bay.sessions.list();
```

Broad-impact shell operations can stop with `pendingApproval` instead of executing automatically:

```ts
const turn = await bay.turn({ input: "Run the requested release operation." });

if (turn.pendingApproval) {
  const { approval } = await bay.approvals.get(turn.sessionId);

  // Show approval.title, approval.summary, and approval.commandHint to the user.
  // Only call approve after an explicit user decision.
  const outcome = await bay.approvals.approve(
    turn.sessionId,
    turn.pendingApproval.id,
  );
  console.log(outcome.result);
}
```

Reject it with:

```ts
await bay.approvals.cancel(turn.sessionId, turn.pendingApproval.id);
```

Approval executes the stored pending shell command in the session workspace. It does not run a second agent turn or automatically produce a new assistant explanation. The app should render the returned command result and optionally start a follow-up turn. Approval routes currently identify ownership by session and approval IDs; treat both as sensitive and expose approval controls only through trusted app code.

## 8. Memory, knowledge, and traces

These helpers use the client's configured workspace:

```ts
const memory = await bay.memory.get();
const refreshedMemory = await bay.memory.refresh();

const knowledge = await bay.knowledge.get();
const refreshedIndex = await bay.knowledge.refresh();
const { results } = await bay.knowledge.search("authentication flow");

const latestTrace = await bay.traces.latest();
```

`get()` and trace responses return human-readable `content`. Knowledge search returns up to 10 results. Refresh operations may perform filesystem indexing and should be presented as explicit, potentially slower actions rather than run on every render.

## 9. Service discovery and readiness

```ts
const health = await bay.health();
const status = await bay.status();
const capabilities = await bay.capabilities();
```

- `health()` reports that the HTTP process is alive and includes the Switchbay version.
- `status()` currently reports the API version, queued turn count, and active request count.
- `capabilities()` lists supported feature families and identifies SSE as the streaming transport.

These endpoints do not currently verify model credentials or provider availability. A healthy process can still fail a turn because its selected provider is unavailable or misconfigured.

## 10. Errors

JSON client methods throw `SwitchbayError`:

```ts
import { SwitchbayError } from "@genoventures/switchbay";

try {
  await bay.turn({ input: "Continue", sessionId: "missing-session" });
} catch (error) {
  if (error instanceof SwitchbayError) {
    console.error(error.status, error.code, error.message, error.details);
  }
}
```

Useful machine-readable codes include:

| Code | Meaning |
| --- | --- |
| `unauthorized` | Missing or incorrect bearer token |
| `bad_request` | Invalid JSON, missing input, invalid workspace, lane, or identifier |
| `not_found` | Unknown route |
| `request_not_found` | Cancellation target is no longer active |
| `session_not_found` | Session does not exist |
| `session_scope_mismatch` | Session and requested workspace/client do not match |
| `no_pending_approval` | Session has no command awaiting approval |
| `approval_mismatch` | Approval ID does not match the pending request |
| `cancelled` | Active turn was aborted |
| `internal_error` | Unexpected service or provider failure |

Streaming errors arrive as `error` events; `turnStream()` does not currently convert those terminal events into `SwitchbayError` automatically.

## 11. Raw HTTP example

```bash
TOKEN="$(tr -d '\n' < "$HOME/.switchbay/api-token")"

curl -sS http://127.0.0.1:7349/v1/turn \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "input": "Summarize this workspace",
    "workspace": "/absolute/path/to/project",
    "clientId": "my-local-app",
    "newSession": true
  }'
```

For SSE, call `/v1/turn/stream` with the same JSON body and `accept: text/event-stream`.

## Endpoint reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Public process health |
| `GET` | `/v1/status` | Queue and active-request status |
| `GET` | `/v1/capabilities` | API feature discovery |
| `POST` | `/v1/turn` | Run a JSON agent turn |
| `POST` | `/v1/turn/stream` | Run a turn over SSE |
| `POST` | `/v1/requests/:requestId/cancel` | Cancel active work |
| `GET` | `/v1/sessions?clientId=&workspace=` | List scoped sessions |
| `GET` | `/v1/sessions/:sessionId/approval` | Inspect pending approval |
| `POST` | `/v1/sessions/:sessionId/approval/approve` | Execute pending command; body: `approvalId` |
| `POST` | `/v1/sessions/:sessionId/approval/cancel` | Clear pending command; body: `approvalId` |
| `GET` | `/v1/memory?workspace=` | Describe workspace memory |
| `POST` | `/v1/memory/refresh` | Refresh memory; body: `workspace` |
| `GET` | `/v1/knowledge?workspace=` | Describe knowledge index |
| `POST` | `/v1/knowledge/refresh` | Refresh index; body: `workspace` |
| `GET` | `/v1/knowledge/search?q=&workspace=` | Search knowledge |
| `GET` | `/v1/trace/latest?workspace=` | Describe latest trace |

## Current boundaries

- Agent turns are serialized through one process-wide queue. Multiple apps can connect, but turns execute one at a time.
- Streaming is SSE, not WebSocket, and events are not replayable after disconnection.
- There is no per-client token, role system, workspace allowlist, or CORS policy. The bearer token grants the service the same filesystem and command authority as the macOS user running it.
- `/health` means the process is alive; it is not a provider-readiness probe.
- The installed service is a built snapshot. Re-run `switchbay service install` after changing Switchbay's server code.
- Explicit cancellation during a turn is practical through streaming; a normal JSON turn reveals its request ID only when it returns.
- Approval completion returns command output but does not resume agent reasoning automatically.
- API version 1 is present in the URL, but there is not yet a generated OpenAPI specification or compatibility guarantee for every response field.

For local app integrations, the safest baseline is: keep the service loopback-only, store the token in trusted backend code, give each app a stable `clientId`, use absolute workspace paths, stream long work, and require a visible user decision before approving a command.
