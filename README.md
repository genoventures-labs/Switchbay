# Switchbay

[![Version](https://img.shields.io/badge/version-1.6.7-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![UI](https://img.shields.io/badge/UI-React%20%2B%20Ink-2563eb)](https://github.com/vadimdemedes/ink)
[![Model lanes](https://img.shields.io/badge/lanes-cloud%20%7C%20local%20%7C%20MCP-16a34a)](#model-lanes)
[![Engine Bay](https://img.shields.io/badge/Engine%20Bay-GitHub%20sync-7c3aed)](#engine-bay)
[![Skills](https://img.shields.io/badge/Skills-agent%20methods-0f766e)](#skills)
[![Plugins](https://img.shields.io/badge/Plugins-local%20bundles-11a79b)](#plugins)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay is a terminal-first AI coding workbench.** Cloud intelligence, local control, provider independence — all in one fast shell. No rebuilding your workflow every time the model landscape shifts.

Inside the TUI, the assistant answers to **Bay**. Switchbay is the workbench. Bay is the callsign.

> Cloud when it helps. Local when it matters. Same rig either way.

---

## Why Switchbay?

Most AI coding tools lock you into one model, one cloud, or one backend. Switchbay is different.

It's a **routing layer, context loader, local tool runner, memory system, session keeper, approval gate, engine registry, and terminal cockpit** — all wired together so you can work fast without losing control.

- **Switch between cloud and local models** without touching your workflow
- **Your codebase, your context** — workspace memory, pinned files, sourced knowledge snippets
- **Extend anything** — swappable engines, reusable skills, local plugins
- **Stay in the terminal** — everything in one fast TUI, no browser, no dashboards

Built for solo builders, senior developers, technical founders, and internal-tool people who live in the terminal.

---

## Install

```bash
brew tap genoventures-labs/tap
brew install switchbay
switchbay
```

From source:

```bash
bun install
bun link
switchbay --help
```

---

## Model Lanes

Switchbay routes between cloud and local without changing your workflow.

**Cloud** (OpenAI, Anthropic, Google — auto-routed or pinned):

```bash
export SWITCHBAY_LANE=cloud
export SWITCHBAY_CLOUD_PROVIDER=auto  # auto | openai | anthropic | google
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...
```

**Local via Ollama:**

```bash
export SWITCHBAY_LANE=local
export SWITCHBAY_LOCAL_PROVIDER=ollama
export SWITCHBAY_OLLAMA_MODEL=llama3.2
```

**Pull and manage models:**

```bash
switchbay model pull ibm/granite-4-micro
switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M
switchbay cloud-provider set anthropic
switchbay local-provider set ollama
```

Inside the TUI, `/lane` cycles cloud and local. `/lane openai`, `/lane anthropic`, `/lane google`, `/lane ollama` pin a provider instantly. Routing is transparent — completed turns show exactly what model and intent was used:

```text
Using: cloud/anthropic/claude-sonnet-4-5 · intent=code_work · mode=auto
```

---

## What Bay Can Do

```bash
switchbay                          # open the TUI
switchbay "find the auth bug"      # one-shot query
switchbay --resume                 # pick up where you left off
switchbay --mode build             # switch working style
switchbay serve                    # start the local API server
switchbay update                   # pull latest, commit/push, reinstall
```

**Inside a session, Bay can:**

- Read, write, search, and run code in your workspace
- Plan, review, debug, and implement — move between specialist agents (`/agent backend`, `/agent security`, `/agent ui`)
- Pull sourced snippets from code, docs, memory, rules, and skill files
- Stage approvals for destructive or publishing-impact commands
- Save memories, pin files, keep sessions, and resume work

---

## Engine Bay

Engines are swappable tool manifests. Drop a JSON file and Bay gains new callable tools — no code changes, no restarts.

```json
{
  "id": "demo",
  "name": "Demo Engine",
  "tools": [
    {
      "name": "say",
      "description": "Print text.",
      "command": "printf {{text}}",
      "parameters": { "text": { "type": "string" } },
      "required": ["text"]
    }
  ]
}
```

Switchbay auto-discovers engines from `.switchbay/engines/`, `~/.switchbay/engines/`, and `SWITCHBAY_ENGINE_PATHS`. The GitHub-backed **Engine Bay** lets you sync community engine templates in one command:

```bash
switchbay engines sync
```

Built-in engines include a guarded **Web Engine** (safe URL reads, no private hosts) and a **Creative Engine** (briefs, naming, positioning, hooks, copy drafting, content calendars).

---

## Skills

Skills are reusable working methods — markdown files with frontmatter that Bay reads before tackling a task. Think of them as portable SOPs for your agents.

Built-in skills: `code-review-pass`, `debugging-triage`, `implementation-plan`, `release-readiness`, `test-strategy`, `ui-polish-pass`, `api-contract-check`, `web-research`.

```bash
switchbay skills sync              # pull latest from GitHub
switchbay skills list
switchbay skills read release-readiness
```

The TUI auto-checks for skill updates on startup and offers to sync with a single keypress.

---

## Plugins

Bundle agents, skills, engines, guides, knowledge, and MCP configs into a single portable `plugin.json` under `.switchbay/plugins/<id>/`. Everything loads automatically — no registration needed.

```json
{
  "id": "repo-ops",
  "name": "Repo Ops",
  "agents": ["agents/repo-steward.md"],
  "skills": ["skills/repo-check.skill.md"],
  "engines": ["engines/repo-tools.engine.json"],
  "guides": ["guides/repo-domain.md"]
}
```

---

## Local API

Switchbay runs a local HTTP API on `127.0.0.1:7349` for editor integrations, desktop apps, and scripting:

```bash
switchbay serve
curl -s http://127.0.0.1:7349/v1/turn \
  -H 'content-type: application/json' \
  -d '{"input":"Summarize this workspace","workspace":"/path/to/project"}'
```

Or use the TypeScript client:

```ts
import { Switchbay } from "@genoventures/switchbay";

const bay = new Switchbay({ token: process.env.SWITCHBAY_API_TOKEN, workspace: "/path/to/project" });
const turn = await bay.turn({ input: "Review the auth flow." });
console.log(turn.content);
```

Install as a macOS background service so the API is always running:

```bash
switchbay service install
switchbay service status
```

---

## Workspace Context

Switchbay builds a rich context layer so Bay always knows your project:

| File / Path | Purpose |
|---|---|
| `SWITCHBAY.md` | Persistent project context |
| `.switchbay/memory/` | Workspace memory and operational facts |
| `.switchbay/knowledge/` | Local RAG source map (Workspace Knowledge) |
| `.switchbay/traces/` | Durable turn receipts (Trace Ledger) |
| `.switchbay/pins.json` | Pinned files always in context |
| `.switchbay/agents/*.md` | Custom specialist agents |
| `.switchbay/engines/*.engine.json` | Workspace engine manifests |
| `.switchbay/plugins/*/plugin.json` | Local plugin bundles |
| `.switchbay/rules/*.rule.md` | Workspace-specific operating rules |
| `~/.switchbay/rules/*.rule.md` | User rules shared across repos |

---

## Key TUI Commands

```text
/lane              Cycle or pin a model provider
/model             Switch active model
/agent <id>        Activate a specialist agent
/plan              Generate and execute a step-by-step plan
/remember          Save a workspace memory note
/pin               Pin a file into future context
/search            Search Workspace Knowledge
/skills            Show or sync agent skills
/engines           List registered engines
/trace             Show the latest turn receipt
/resume            Pick up a previous session
/checkpoint        Save a git-stash checkpoint
/create-rule       Create a custom operating rule
/create-agent      Create a custom agent
/create-engine     Create a custom engine manifest
/create-plugin     Create a local plugin
```

---

## Documentation

Full reference docs live in [`docs/`](docs/):

| Doc | Contents |
|---|---|
| [MODEL_LANES.md](docs/MODEL_LANES.md) | Cloud, local, MCP bridge, auto-routing, per-command overrides |
| [ENGINE_BAY.md](docs/ENGINE_BAY.md) | Engine manifests, GitHub sync, Web Engine, Creative Engine, GumOps, Thinkapse |
| [SKILLS.md](docs/SKILLS.md) | Built-in skills, custom skill authoring, GitHub sync, model tools |
| [PLUGINS.md](docs/PLUGINS.md) | Plugin manifest format, asset types, creating plugins, plugin guides |
| [MEMORY_KNOWLEDGE_TRACES.md](docs/MEMORY_KNOWLEDGE_TRACES.md) | Operational memory, Workspace Knowledge, Trace Ledger, Quick Starts/Rules |
| [SLASH_COMMANDS.md](docs/SLASH_COMMANDS.md) | Complete TUI slash command reference |
| [APPROVAL_MODEL.md](docs/APPROVAL_MODEL.md) | What gates for approval, what runs freely, approval flow and API |
| [API_INTEGRATION.md](docs/API_INTEGRATION.md) | Local HTTP API, app integration, TypeScript client |
| [LOCAL_API_README.md](docs/LOCAL_API_README.md) | Underlying local API route design |
| [1.0_SMOKE_CHECKLIST.md](docs/1.0_SMOKE_CHECKLIST.md) | Release-readiness smoke test checklist |
| [1.5_ROADMAP.md](docs/1.5_ROADMAP.md) | Bay operator direction and roadmap |

---

## Development

```bash
bun install
bun test
bun run build
bun index.tsx      # run from source
switchbay update   # commit local changes, push, pull latest, rebuild
```

---

## License

MIT
