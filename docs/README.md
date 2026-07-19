# Switchbay

[![Version](https://img.shields.io/badge/version-1.6.30-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay is a model management system for working across local and cloud AI runtimes.**

The AI model landscape is fragmented across providers, runtimes, and APIs. Switchbay gives you a single interface to register models, switch runtimes, benchmark quality, and run a persistent agent — without reconfiguring your environment for each provider or session.

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

Run as a background service so the local API is always available:

```bash
switchbay service install
switchbay service status
```

---

## Model catalog

Switchbay maintains a central catalog of the models you've added. There are no built-in presets — only models you explicitly register are shown in listings, benchmarks, and routing.

```bash
# Add models
switchbay model add claude-opus-4-8
switchbay model add gpt-4o
switchbay model add gemini-2.5-flash
switchbay model add gpt-4o --label "GPT-4o (Production)"

# Browse
switchbay models                          # your full catalog
switchbay models --provider anthropic     # filter by provider
switchbay models --trusted                # A/B grade models only
switchbay models list --all               # all lanes in one view

# Remove
switchbay model remove claude-haiku-4-5   # remove one model
switchbay model remove --lane openai      # remove all openai models
switchbay models clear                    # clear everything
switchbay models clear --provider google  # clear one provider

# Verify
switchbay model verify                    # test the active model
```

---

## Runtimes and lanes

Switchbay uses the concept of **lanes** to route inference. Each lane maps to a runtime — cloud APIs, local servers, or on-device inference.

| Lane | Providers | Notes |
|---|---|---|
| `cloud` | OpenAI · Anthropic · Google | Auto-routed by task, or pinned to one provider |
| `local` | Ollama · llama.cpp · MLX | Requires a running local server |
| `apple` | AFM 3 Core · Core Advanced · Cloud · Cloud Pro | macOS 26 + Apple Intelligence |
| `openrouter` | OpenRouter | Requires `OPENROUTER_API_KEY` |
| `huggingface` | HF Inference Providers | Requires `HF_TOKEN` |

Set the lane via flag, env var, or mid-session command:

```bash
switchbay --lane cloud                   # cloud for this session
switchbay --lane local                   # local for this session
export SWITCHBAY_LANE=local              # default for all sessions
```

Inside the TUI: `/lane cloud`, `/lane local`, or `/lane apple` — switches without restarting.

**Cloud auto-routing** picks the best available provider for each task based on intent — code-heavy work, structured output, and vision tasks each route differently. Every turn logs the decision:

```
Using: cloud/anthropic/claude-opus-4-8 · intent=code_work · mode=auto
```

**Rate limit handling** — if OpenRouter hits its rate limit, Switchbay automatically falls back to cloud routing and surfaces a notice in the stream. If usage is approaching the limit, a warning notice appears before the turn runs.

**Local models** via Ollama:

```bash
switchbay model pull llama3.2 -y
switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M
```

**Local-only mode** — gate cloud calls behind a confirm prompt, or go fully air-gapped:

```bash
switchbay local-mode set local      # local inference, web tools on
switchbay local-mode set offline    # local inference, no network tools
switchbay local-mode set off        # restore default routing
```

---

## Benchmarking

Before adding a model to your trusted pool, run a pre-bench to grade it. Grades are stored locally and surface next to models in all listings.

```bash
switchbay benchmark --pre           # grade your entire catalog (concurrent)
switchbay benchmark <model-id>      # full 10-test suite on one model
switchbay models --trusted          # show only A/B graded models
```

**Grade scale:** A+ · A · B · C · D · F

**Test suite:** coherence, instruction following, JSON output, tool calls, multi-turn memory, safety/refusal, response latency, long context retrieval, markdown formatting, numeric reasoning.

**Pre-bench** runs the 4 highest-signal tests across all catalog models concurrently, then grades each one. Auth errors and network failures are flagged separately from genuine score failures — a model that errors due to a bad API key shows `○ no key / auth error` rather than an F grade.

**Trusted pool** — models with A+ · A · B grades are marked trusted. Use `--trusted` on any models command to filter to this set.

---

## Agent workspace

Switchbay runs a persistent agent with tools, memory, and session context that carries forward across tasks.

```bash
switchbay                              # open the terminal workspace (TUI)
switchbay "find the auth bug"          # one-shot, no session needed
switchbay --resume                     # continue the last session
switchbay --resume <id>                # continue a specific session
switchbay open                         # open the visual web workspace
switchbay brief                        # open the Brief document editor
switchbay docs                         # open the in-app docs wiki
switchbay serve [--detach]             # start the local API server
```

The agent routes every turn through whatever model and lane are active. Switching models or lanes mid-session doesn't lose context — the same memory, session history, and workspace state carry through.

---

## Extending

**Engines** — add callable tools via JSON manifest. Drop a `.engine.json` file in `.switchbay/engines/` and it's live on the next turn with no restarts.

```json
{
  "id": "run-tests",
  "tools": [{
    "name": "run_tests",
    "description": "Run the test suite and return output.",
    "command": "bun test --reporter json",
    "parameters": {}
  }]
}
```

**Skills** — reusable working methods. Switchbay reads the relevant skill before a task and applies the method, not just the answer. Built-in: `code-review-pass`, `debugging-triage`, `implementation-plan`, `release-readiness`, `test-strategy`, `ui-polish-pass`.

**Agents** — specialist personas that shift Switchbay's operating lens — priorities, review criteria, what it flags — without changing the session or tools. Built-in: `ui-designer`, `backend`, `devops`, `debugger`, `architect`, `security`, `docs`, `reviewer`.

**Sync both at once:**

```bash
switchbay sync           # sync engines and skills together
switchbay engines sync   # engines only
switchbay skills sync    # skills only
```

**Plugins** — bundle agents, engines, skills, and knowledge files into a portable manifest. Drop it in `.switchbay/plugins/<id>/plugin.json` and it loads automatically.

---

## Persistent context

Switchbay carries context across every session:

| Source | Contents |
|---|---|
| `SWITCHBAY.md` | Project overview, stack decisions, permanent context |
| `.switchbay/memory/` | Session memories and operational facts |
| `.switchbay/knowledge/` | Local knowledge index — sourced docs and code |
| `.switchbay/traces/` | Durable receipts for every completed turn |
| `~/.switchbay/rules/` | Personal operating rules, across all repos |

```bash
switchbay memory                          # workspace memory
switchbay knowledge search <query>        # query indexed documents
switchbay trace                           # last turn receipt
switchbay usage                           # turns, tokens, spend
```

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

const bay = new Switchbay({
  token: process.env.SWITCHBAY_API_TOKEN,
  workspace: "/path/to/project",
});
const turn = await bay.turn({ input: "Review the auth flow." });
```

Full reference: [API_INTEGRATION.md](API_INTEGRATION.md)

---

## TUI slash commands

```
/lane · /model              Switch lane or model mid-session
/agent <id>                 Activate a specialist agent
/plan                       Generate and execute a step-by-step plan
/sync                       Sync engines and skills from remote
/remember                   Save a workspace memory
/pin                        Pin a file into future context
/search                     Search the knowledge index
/trace                      Show the last turn receipt
/resume                     Resume a previous session
/brief                      Open the Brief document editor
/create-agent               Define a custom specialist agent
/create-engine              Create a new engine manifest
/create-plugin              Bundle into a plugin
```

Full reference: [SLASH_COMMANDS.md](SLASH_COMMANDS.md)

---

## Documentation

| Doc | Contents |
|---|---|
| [MODEL_LANES.md](MODEL_LANES.md) | Cloud, local, Apple, OpenRouter, HuggingFace — routing and config |
| [AGENTS.md](AGENTS.md) | Built-in specialists, custom agent authoring |
| [ENGINE_BAY.md](ENGINE_BAY.md) | Engine manifests, GitHub sync, built-in engines |
| [SKILLS.md](SKILLS.md) | Built-in skills, custom skill authoring |
| [PLUGINS.md](PLUGINS.md) | Plugin manifest format, asset types |
| [MEMORY_KNOWLEDGE_TRACES.md](MEMORY_KNOWLEDGE_TRACES.md) | Memory, Knowledge Index, Trace Ledger |
| [MCP_BRIDGE.md](MCP_BRIDGE.md) | MCP tool bridge — config and catalog |
| [SLASH_COMMANDS.md](SLASH_COMMANDS.md) | Complete TUI slash command reference |
| [APPROVAL_MODEL.md](APPROVAL_MODEL.md) | What gates for approval, what runs freely |
| [API_INTEGRATION.md](API_INTEGRATION.md) | Local HTTP API and TypeScript client |

---

## Development

```bash
bun install
bun test
bun index.tsx        # run from source
switchbay update     # commit, push, pull latest, reinstall
```

---

MIT
