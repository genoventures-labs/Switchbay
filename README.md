# Switchbay

[![Version](https://img.shields.io/badge/version-1.6.30-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![Model lanes](https://img.shields.io/badge/lanes-cloud%20%7C%20local%20%7C%20MCP-16a34a)](#model-lanes)
[![Engine Bay](https://img.shields.io/badge/Engine%20Bay-extensible%20tools-7c3aed)](#engine-bay)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay is your AI operating system.** One persistent agent that lives in your terminal, knows every project you work in, routes across every model without breaking your flow, and extends through engines, skills, agents, and plugins — without touching its core.

The model is a variable. Switchbay is the constant.

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

## What It Is

Most AI tools are wrappers — they hand your input to a model and return the output. Switchbay is an agent. It reasons, plans, uses tools, reads and writes your environment, and surfaces decisions to you when they matter.

It also isn't locked to one model, one provider, or one context window. Sessions carry forward. Memory persists. Capabilities compose.

```bash
switchbay                              # open the TUI
switchbay "find the auth bug"          # one-shot, no session needed
switchbay --resume                     # pick up where you left off
switchbay --agent security "review PR" # activate a specialist
switchbay serve                        # start the local API
```

---

## Model Lanes

Switch providers, models, and routing strategies mid-session — no restart, no lost context.

```bash
# Cloud — auto-routes between OpenAI, Anthropic, Google by intent
export SWITCHBAY_LANE=cloud
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...

# Local
export SWITCHBAY_LANE=local
export SWITCHBAY_OLLAMA_MODEL=llama3.2

# OpenRouter, Hugging Face, Ollama Cloud also supported
```

Address a model by name mid-session to pin it for following turns:

```text
Claude, inspect this repo
GPT, review Claude's plan
Auto, choose the best model for the next step
```

Auto-routing picks by intent — code work goes to Anthropic, structured tasks and vision to OpenAI, long-context synthesis to Gemini. Every turn logs the decision.

Full reference: [MODEL_LANES.md](docs/MODEL_LANES.md)

---

## Specialist Agents

Activate a specialist and Switchbay's entire lens shifts — priorities, review criteria, what it flags, what it won't do — without changing your session or context.

| Agent | Focus |
|---|---|
| 🎨 UI Designer | Hierarchy, accessibility, design systems |
| ⚙️ Backend Engineer | APIs, schema, auth, query performance |
| 🚀 DevOps | CI/CD, containers, infra, observability |
| 🔍 Debugger | Root cause, bisect, reproduction |
| 🏗️ Architect | System design, tradeoffs, long-term structure |
| 🔒 Security | Threat modeling, injection, auth, secrets |
| 📝 Tech Writer | Accuracy, reader-first, working examples |
| 👁️ Code Reviewer | Blocking issues, edge cases, test gaps |

Build your own with `/create-agent`. Full reference: [AGENTS.md](docs/AGENTS.md)

---

## Subagents

Switchbay can spawn focused subagents mid-turn to handle parallel or specialized work, then synthesize the results back into the main session.

```text
spawn_agent — run a scoped task in an isolated context and return the result
```

Subagents run with the same engine and tool access as the parent, can't recurse, and are capped at 12 iterations. The parent waits, collects, and continues.

---

## Engine Bay

A JSON manifest drops new callable tools into Switchbay — no source changes, no restarts.

```json
{
  "id": "my-engine",
  "name": "My Engine",
  "tools": [
    {
      "name": "do_thing",
      "description": "Does the thing.",
      "command": "python3 do_thing.py --input {{input}}",
      "parameters": { "input": { "type": "string" } },
      "required": ["input"]
    }
  ]
}
```

Drop it in `.switchbay/engines/` and it's live. Community engines via GitHub sync:

```bash
switchbay engines sync
```

**Available engines:** Web (guarded reads), Creative (writing tools), Research Helpers, Memory Helper, File Helper, Web Search, and more via the Engine Bay.

Full reference: [ENGINE_BAY.md](docs/ENGINE_BAY.md)

---

## Skills

Reusable working methods — Switchbay reads a skill before tackling a task and applies the method, not just the output.

Built-in: `code-review-pass`, `debugging-triage`, `implementation-plan`, `release-readiness`, `test-strategy`, `ui-polish-pass`, `api-contract-check`, `web-research`

```bash
switchbay skills sync
switchbay skills read release-readiness
```

Write your own in markdown. Full reference: [SKILLS.md](docs/SKILLS.md)

---

## Plugins

Bundle agents, engines, skills, guides, and knowledge into a single portable manifest.

```json
{
  "id": "repo-ops",
  "name": "Repo Ops",
  "agents": ["agents/repo-steward.md"],
  "skills": ["skills/repo-check.skill.md"],
  "engines": ["engines/repo-tools.engine.json"]
}
```

Drop in `.switchbay/plugins/<id>/plugin.json` — no registration, no restarts. Full reference: [PLUGINS.md](docs/PLUGINS.md)

---

## Persistent Context

Switchbay never starts from scratch.

| Source | What It Carries |
|---|---|
| `~/.switchbay/context/` | Profile, work style, preferences, active projects |
| `SWITCHBAY.md` | Project overview, stack decisions, permanent context |
| `.switchbay/memory/` | Session memories and operational facts |
| `.switchbay/knowledge/` | Local knowledge index — code, docs, sourced snippets |
| `.switchbay/pins.json` | Files always in context |
| `~/.switchbay/rules/` | Personal operating rules, across every repo |
| `.switchbay/traces/` | Durable receipts for every completed turn |

Memory is on-demand — models search and recall via the Memory Helper engine rather than loading everything into every prompt.

Full reference: [MEMORY_KNOWLEDGE_TRACES.md](docs/MEMORY_KNOWLEDGE_TRACES.md)

---

## Local API

```bash
switchbay serve

curl -s http://127.0.0.1:7349/v1/turn \
  -H 'content-type: application/json' \
  -d '{"input":"Review the auth flow","workspace":"/path/to/project"}'
```

```ts
import { Switchbay } from "@genoventures/switchbay";
const bay = new Switchbay({ token: process.env.SWITCHBAY_API_TOKEN, workspace: "/path/to/project" });
const turn = await bay.turn({ input: "Review the auth flow." });
```

Full reference: [API_INTEGRATION.md](docs/API_INTEGRATION.md)

---

## Key Commands

```text
/lane · /model          Switch provider or model mid-session
/agent <id>             Activate a specialist agent
/plan                   Generate and execute a step-by-step plan
/remember               Save a workspace memory
/pin                    Pin a file into future context
/search                 Search the knowledge index
/resume                 Resume a previous session
/trace                  Show the latest turn receipt
/create-agent           Define a custom specialist
/create-engine          Create an engine manifest
/create-plugin          Bundle everything into a plugin
```

Full reference: [SLASH_COMMANDS.md](docs/SLASH_COMMANDS.md)

---

## Documentation

| Doc | Contents |
|---|---|
| [MODEL_LANES.md](docs/MODEL_LANES.md) | Cloud, local, MCP, auto-routing |
| [MCP_BRIDGE.md](docs/MCP_BRIDGE.md) | Switchbay MCP bridge |
| [AGENTS.md](docs/AGENTS.md) | Specialist agents, custom authoring |
| [ENGINE_BAY.md](docs/ENGINE_BAY.md) | Engine manifests, sync, built-in engines |
| [SKILLS.md](docs/SKILLS.md) | Skills, custom authoring, sync |
| [PLUGINS.md](docs/PLUGINS.md) | Plugin format, asset types |
| [MEMORY_KNOWLEDGE_TRACES.md](docs/MEMORY_KNOWLEDGE_TRACES.md) | Memory, knowledge, traces |
| [APPROVAL_MODEL.md](docs/APPROVAL_MODEL.md) | What gates for approval |
| [API_INTEGRATION.md](docs/API_INTEGRATION.md) | Local HTTP API and TypeScript client |
| [SLASH_COMMANDS.md](docs/SLASH_COMMANDS.md) | Complete TUI command reference |

---

## License

MIT
