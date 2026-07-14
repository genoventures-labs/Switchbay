# Memory, Knowledge & Traces

Switchbay keeps your workspace context close, readable, and persistent across sessions — without cloud syncing or background services.

---

## Operational Memory

Workspace memory is scoped per-repo and stays human-readable. Switchbay can read, write, and refresh it during sessions.

### Files

| File | Purpose |
|---|---|
| `.switchbay/memory/notes.md` | Remembered notes |
| `.switchbay/memory/summary.md` | Refreshed operational summary |
| `.switchbay/memory/facts.json` | Structured facts from project context, package metadata, and git |
| `.switchbay/memory/config.json` | Prompt-size and refresh settings |
| `.switchbay/memory.md` | Compatibility note list (written alongside the new store) |

Memory is injected into sessions as a compact operational block. Files are not created until you first use `/remember`, `/memory refresh`, or `switchbay memory`.

### CLI

```bash
switchbay memory
switchbay memory refresh
switchbay memory list
switchbay memories list
switchbay memory facts
```

### TUI

```text
/remember use Bun for tests
/memories
/forget 0
/memory
/memory refresh
/memory facts
```

### Model Tools

| Tool | Description |
|---|---|
| `memory_status` | Show the current memory store state |
| `memory_refresh` | Rebuild the operational summary |
| `memory_remember` | Save a new note to memory |
| `memory_facts` | Read structured project facts |

---

## Workspace Knowledge

Workspace Knowledge is Switchbay's local RAG layer. It builds a readable source map at `.switchbay/knowledge/index.json` and automatically injects relevant snippets into Switchbay's turn context with file and line spans.

Indexable content: code, markdown/docs, config, memory, rules, engines, and Skills material.

### CLI

```bash
switchbay knowledge
switchbay knowledge refresh
switchbay knowledge search "approval gates"
```

### TUI

```text
/index
/index refresh
/search approval gates
```

The backend is intentionally simple: line-based chunks, local lexical scoring, and normal path citations (`README.md:120-160`). Embeddings or SQLite FTS can be added later without changing how Switchbay consumes retrieved context.

---

## Trace Ledger

Trace Ledger is Switchbay's local flight recorder. Completed model turns write JSON receipts under `.switchbay/traces/` so you can review exactly what Switchbay knew, what it touched, what tools ran, and what answer came back.

### What a Trace Records

- User prompt
- Runtime lane and tool mode
- Workspace branch
- Injected Workspace Knowledge sources
- Tool executions (name, args, result summary)
- Changed files
- Pending shell approvals
- Rough prompt/answer token estimates
- Finish reason
- Final assistant answer

### CLI

```bash
switchbay trace
switchbay trace export
switchbay radar
switchbay handoff
```

### TUI

```text
/trace
/trace last
/trace export
```

---

## Quick Starts and Rules

Switchbay injects a compact Quick Starts and Rules block into Switchbay's system context. These guides act like small "read this first" packets before Switchbay uses a tool lane, edits a file type, or follows a custom workflow.

Built-in guides cover: local tool use, Web Engine, Switchbay MCP setup, Engine Bay calls, and local-first workspace boundaries.

### File Locations

```text
~/.switchbay/rules/*.rule.md           User rules (all repos)
~/.switchbay/quickstarts/*.md          User quick-starts (all repos)
.switchbay/rules/*.rule.md             Workspace rules
.switchbay/quickstarts/*.md            Workspace quick-starts
.switchbay/plugins/<id>/guides/*.md    Plugin-bundled guides
```

Rules created via `/create-rule` default to `~/.switchbay/rules` so they follow you across projects. Choose `workspace` in the rule builder for repo-specific behavior.

### TUI

```text
/quickstarts
/rules
/create-rule
```

---

## Workspace Files Reference

Full list of paths Switchbay reads and writes:

| Path | Purpose |
|---|---|
| `SWITCHBAY.md` | Persistent project context injected every session |
| `.switchbay/memory/` | Operational memory store |
| `.switchbay/knowledge/index.json` | Workspace Knowledge source map |
| `.switchbay/traces/` | Durable turn receipts |
| `.switchbay/pins.json` | Pinned files and repo notes |
| `.switchbay/agents/*.md` | Custom local specialist agents |
| `.switchbay/engines/*.engine.json` | Workspace engine manifests |
| `.switchbay/plugins/*/plugin.json` | Local plugin bundles |
| `.switchbay/rules/*.rule.md` | Workspace-specific operating rules |
| `.switchbay/quickstarts/*.md` | Workspace-specific quick-start guides |
| `~/.switchbay/rules/*.rule.md` | User rules shared across repos |
| `~/.switchbay/quickstarts/*.md` | User quick-starts shared across repos |
| `~/.switchbay/cloud-providers.json` | Cloud provider routing config |
| `~/.switchbay/cloud-models.json` | Custom cloud model catalog |
| `~/.switchbay/local-providers.json` | Local provider config |
