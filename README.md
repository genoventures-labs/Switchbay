# Switchbay

[![Version](https://img.shields.io/badge/version-1.5.8-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![UI](https://img.shields.io/badge/UI-React%20%2B%20Ink-2563eb)](https://github.com/vadimdemedes/ink)
[![Model lanes](https://img.shields.io/badge/lanes-cloud%20%7C%20local%20%7C%20MCP-16a34a)](#model-lanes)
[![Engine Bay](https://img.shields.io/badge/Engine%20Bay-GitHub%20sync-7c3aed)](#engine-bay)
[![Skills](https://img.shields.io/badge/Skills-agent%20methods-0f766e)](#skills)
[![Plugins](https://img.shields.io/badge/Plugins-local%20bundles-11a79b)](#plugins)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay** is a terminal-first AI coding workbench for developers who want cloud intelligence, local control, and provider independence without rebuilding their workflow every time the model stack changes.

It is the workbench around the model: a routing layer, context loader, local tool runner, memory system, session keeper, approval gate, engine registry, and terminal cockpit for agentic coding work.

Inside the TUI, the assistant answers to **Bay**. Switchbay is the workbench; Bay is the callsign.

Cloud when it helps. Local when it matters. Same rig either way.

## What It Does

Switchbay gives you one fast shell for everyday agentic development:

- Load repo context and persistent workspace memory.
- Talk through plans, architecture, debugging, reviews, and implementation.
- Inspect files, read ranges, summarize code, search the tree, and check git state.
- Build a local Workspace Knowledge map so Bay can pull sourced snippets from code, docs, memory, rules, engines, and skills files.
- Create files, edit files, run commands, execute tests, and build locally.
- Move between specialist agents for backend, UI, security, debugging, architecture, docs, and review.
- Resume sessions, pin context, save local memories, and keep work visible in the terminal.
- Route between cloud models and swappable local providers such as LM Studio and Ollama without changing the workflow.
- Enable Switchbay's MCP bridge for cloud or local models that should use configured tool workflows.
- Add swappable engines from local manifests or the GitHub-backed Engine Bay.
- Give agents reusable skills for review, debugging, planning, testing, API checks, UI polish, and releases.
- Bundle related agents, skills, engines, guides, knowledge notes, and MCP configs as local workspace plugins.

Switchbay is built for solo builders, senior developers, technical founders, and internal-tool people who live in the terminal and want the useful parts of AI coding close to the repo.

## Why It Exists

Most AI coding tools make one model, hosted service, or private backend feel like the product. Switchbay treats intelligence as a set of lanes.

- Use cloud models for deeper reasoning, code review, architecture, and complex implementation.
- Use local LM Studio or Ollama models for smaller utility work, offline-friendly tasks, private machine-close work, and quick summaries.
- Enable Switchbay's MCP bridge when cloud or local models should use configured tool intent through Switchbay's own local tool bridge.
- Keep approvals practical: broad-impact, destructive, privileged, publishing, refunding, and deploy-style actions still gate.
- Keep the workbench useful even if a provider, hosted API, VPS, or local model setup changes.
- Keep extensions portable through Engine Bay instead of baking every workflow into the core app.
- Keep reusable agent methods portable through skills instead of hiding them in one-off prompts.
- Keep project-specific capability packs simple with plugin manifests instead of a heavyweight plugin runtime.

## Install

Homebrew:

```bash
brew tap genoventures-labs/tap
brew install switchbay
switchbay
```

The Homebrew formula and terminal command are both named `switchbay`.

From source:

```bash
bun install
bun link
switchbay --help
```

## Model Lanes

Cloud lane:

```bash
export SWITCHBAY_LANE=cloud
export SWITCHBAY_CLOUD_PROVIDER=auto # auto | openai | anthropic | google
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...
```

Switchbay also stores cloud provider defaults in `~/.switchbay/cloud-providers.json`. Use it to keep provider routing, API bases, key env names, and default models portable without rewriting shell startup files:

```bash
switchbay cloud-provider
switchbay cloud-provider set auto
switchbay cloud-provider set openai
switchbay cloud-provider set anthropic
switchbay cloud-provider set google
```

Custom cloud model ids live in `~/.switchbay/cloud-models.json` and feed the same model drawer/list as built-in presets. Use this when OpenAI or another cloud provider ships a model before Switchbay has baked it in:

```bash
switchbay model add openai gpt-new-model --label "GPT New Model"
switchbay --lane cloud --add-model gpt-new-model
switchbay models --lane cloud
```

Local LM Studio lane:

```bash
export SWITCHBAY_LANE=local
export SWITCHBAY_LMSTUDIO_BASE=http://192.168.1.50:1234/v1 # use your LM Studio host
export SWITCHBAY_LMSTUDIO_API_KEY=... # generate in LM Studio when MCP/tool access is gated
export SWITCHBAY_LMSTUDIO_MODEL=qwen2.5-7b-instruct
```

Local Ollama provider:

```bash
export SWITCHBAY_LANE=local
export SWITCHBAY_LOCAL_PROVIDER=ollama
export SWITCHBAY_OLLAMA_BASE=http://localhost:11434/api
export SWITCHBAY_OLLAMA_MODEL=llama3.2
```

Switchbay MCP bridge:

```bash
export SWITCHBAY_TOOL_MODE=switchbay-mcp
# or: export SWITCHBAY_MCP=on
```

Cloud compatibility alias:

```bash
export SWITCHBAY_LANE=cloud-mcp
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

LM Studio native MCP lane is still available for testing LM Studio's own MCP chat API:

```bash
export SWITCHBAY_LANE=native-mcp
export SWITCHBAY_LMSTUDIO_BASE=http://192.168.1.50:1234/v1
export SWITCHBAY_LMSTUDIO_API_KEY=... # create in LM Studio if auth is enabled
```

Then create or tune `~/.switchbay/lmstudio.mcp.json`:

```json
{
  "enabled": true,
  "nativeBase": "http://192.168.1.50:1234/api/v1",
  "model": "qwen2.5-7b-instruct",
  "integrations": [],
  "mcpServers": {}
}
```

Add only trusted MCP ids that actually exist in your setup, such as `"mcp/playwright"` after Playwright is installed/enabled.

Inside the TUI, use `/lane` to cycle Cloud and the active local provider, `/lane openai`, `/lane anthropic`, or `/lane google` to pin a cloud provider, `/lane ollama` to use Ollama, `/lane lmstudio` to use LM Studio, `/mcp on` to enable Switchbay's MCP bridge under the active model lane, `/mcp off` to disable it, and `/lane native-mcp` only when testing LM Studio's native MCP API. Cloud models use built-in OpenAI, Anthropic, and Google Gemini presets plus `~/.switchbay/cloud-providers.json`; local models are fetched from the active provider in `~/.switchbay/local-providers.json`. Use `/mcp init` for an empty starter config, `/mcp catalog` to list trusted MCP options, or `/create-mcp` for the conversational MCP config builder.

Auto routing is visible by design. When Switchbay chooses a provider/model, completed turns show a tag like:

```text
Using: cloud/anthropic/claude-sonnet-4-5 · intent=code_work · mode=auto
```

The router is deterministic and inspectable: structured/summary tasks favor OpenAI, code/tool-heavy work favors Anthropic, explicit lanes/providers override auto, and local lanes show the active local provider.

Bay only creates MCP configs from Switchbay's trusted catalog: Playwright, filesystem, GitHub, memory, fetch, sequential-thinking, and Postgres. If a request is not in that catalog, Bay refuses to invent a server id and tells you how to proceed manually.

Per command:

```bash
switchbay --lane cloud "review the auth flow"
SWITCHBAY_MCP=on switchbay --lane cloud "use the configured MCP-style browser/file workflow through Switchbay"
switchbay --lane local "summarize the changed files"
SWITCHBAY_MCP=on switchbay --lane local "use my local MCP-style browser workflow through Switchbay"
```

## Usage

Interactive terminal UI:

```bash
switchbay
```

On TUI startup, Bay shows a compact local overview with today's Daily Board, workspace state, active lane, and latest session signal. Quiet the operator layer with:

```bash
export SWITCHBAY_OPERATOR=off
export SWITCHBAY_STARTUP_OVERVIEW=off
export SWITCHBAY_DAILY_BOARD=off
```

Bay also handles obvious operator asks locally before calling a model, such as "Bay, what's on my agenda?", "Bay, what lane am I using?", "Bay, is MCP on?", "Bay, what's changed in git?", "Bay, run radar", "Bay, write a handoff for next time", and "Bay, how do I switch to Ollama?".

For the release-readiness pass, use [docs/1.0_SMOKE_CHECKLIST.md](docs/1.0_SMOKE_CHECKLIST.md).

For the Bay operator direction, use [docs/1.5_ROADMAP.md](docs/1.5_ROADMAP.md).

One-shot request:

```bash
switchbay "find the likely cause of this empty response bug"
```

Resume work:

```bash
switchbay --resume
switchbay --resume 0
```

Change working style:

```bash
switchbay --mode build
switchbay --mode debug
switchbay --surface dev
```

CLI helpers:

```bash
switchbay --help
switchbay version
switchbay update
switchbay models --lane local
switchbay models --lane ollama
switchbay models --lane openai
switchbay models --lane google
switchbay model local qwen/qwen3-4b-2507
switchbay model openai gpt-5.5
switchbay model add openai gpt-new-model --label "GPT New Model"
switchbay --lane cloud --add-model gpt-new-model
switchbay model google gemini-3.5-flash
switchbay cloud-provider set anthropic
switchbay cloud-provider set google
switchbay local-provider set ollama
switchbay model pull ibm/granite-4-micro
switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M
switchbay engines sync
switchbay skills list
switchbay plugins
switchbay memory refresh
switchbay agenda
switchbay task add "test brew install"
switchbay task done 1
switchbay knowledge refresh
switchbay knowledge search "approval gates"
switchbay trace
switchbay trace export
switchbay mcp status
switchbay mcp init
switchbay mcp catalog
```

## Slash Commands

Inside the TUI:

```text
/sessions          List recent local sessions
/resume            Open the session picker
/save              Persist the current session
/new               Start a fresh session
/compact           Compress the transcript into context
/clear             Clear the visible conversation
/lane              Cycle Cloud and the active local provider
/lane openai       Use OpenAI for the cloud lane
/lane anthropic    Use Anthropic for the cloud lane
/lane google       Use Google Gemini for the cloud lane
/model             Pick a cloud preset or LM Studio model
/init              Generate SWITCHBAY.md for this repo
/workspace         Show the active workspace snapshot
/workspace list    List known workspaces
/workspace add     Whitelist a workspace path
/workspace hop     Switch to a known workspace
/hop               Alias for workspace switching
/pin               Pin a file into future turn context
/pins              List pinned files
/remember          Save a workspace memory note
/memories          List workspace memory notes
/memory            Show or refresh operational memory
/agenda            Show today's Daily Board
/task add          Add a task to today's Daily Board
/task done         Mark a Daily Board task done
/task clear        Clear today's Daily Board
/index             Show or refresh Workspace Knowledge
/search            Search sourced Workspace Knowledge snippets
/trace             Show the latest durable turn receipt
/quickstarts       List quick-start guides Bay reads before matching tool work
/rules             List built-in, user, and workspace operating rules
/create-rule       Create a conversational rule for Bay and agents
/review            Review the current diff
/checkpoint        Save a git-stash checkpoint
/checkpoints       List checkpoints
/restore           Restore a checkpoint
/plan              Generate and execute a plan step by step
/collapse          Hide or show the right-side telemetry panels
/agent             Activate a specialist agent
/agents            Browse available agents
/create-agent      Create a custom local agent
/create-skill      Create a custom skill
/plugins           Show installed workspace plugins
/create-plugin     Create a local plugin manifest
/create-mcp        Create a custom Switchbay MCP bridge config
/edit              Open the file edit picker
/engines           List registered engines
/create-engine     Create a custom workspace engine manifest
/engine-bay        Show or sync the GitHub engine hub
/creative          Show the built-in Creative Engine lane
/skills            Show or sync reusable agent skills
/mcp               Show or initialize Switchbay MCP bridge config
/mcp on            Enable the Switchbay MCP bridge for this session
/mcp off           Disable the Switchbay MCP bridge for this session
/mcp catalog       List trusted MCP config options
```

## Workspace Files

Switchbay looks for:

- `SWITCHBAY.md`: persistent project context injected into coding sessions.
- `.switchbay/memory.md`: workspace memory.
- `.switchbay/memory/`: operational memory files.
- `.switchbay/knowledge/index.json`: local Workspace Knowledge source map.
- `.switchbay/traces/`: durable turn receipts and latest trace pointer.
- `.switchbay/pins.json`: pinned files and repo notes.
- `.switchbay/agents/*.md`: custom local specialist agents.
- `.switchbay/engines/*.engine.json`: workspace engine manifests.
- `.switchbay/plugins/*/plugin.json`: local plugin manifests that can bundle agents, skills, engines, guides, knowledge, and MCP configs.
- `.switchbay/rules/*.rule.md`: workspace-specific operating rules.
- `.switchbay/quickstarts/*.md`: workspace-specific quick-start guides.
- `~/.switchbay/rules/*.rule.md`: user operating rules shared across repos.
- `~/.switchbay/quickstarts/*.md`: user quick-start guides shared across repos.
- `~/.switchbay/lmstudio.mcp.json`: user MCP bridge config, also used by the legacy LM Studio native MCP lane.

Switchbay reads and writes the Switchbay names directly. Old project aliases are no longer part of the active workflow.

## Operational Memory

Switchbay keeps memory small and workspace-scoped. Human notes stay readable, while refreshable facts and summaries live in a folder that agents can use during sessions.

Files:

- `.switchbay/memory/notes.md`: remembered notes.
- `.switchbay/memory/summary.md`: refreshed operational summary.
- `.switchbay/memory/facts.json`: structured facts from project context, package metadata, and git.
- `.switchbay/memory/config.json`: prompt-size and refresh settings.
- `.switchbay/memory.md`: compatibility note list written alongside the new store.

Commands:

```bash
switchbay memory
switchbay memory refresh
switchbay memory list
switchbay memory facts
```

TUI:

```text
/remember use Bun for tests
/memories
/forget 0
/memory
/memory refresh
/memory facts
```

Model tools:

- `memory_status`
- `memory_refresh`
- `memory_remember`
- `memory_facts`

Memory is injected into sessions as a compact operational block. Opening a session does not create memory files; `/remember`, `/memory refresh`, or `switchbay memory` initializes the store.

## Workspace Knowledge

Workspace Knowledge is Switchbay's local RAG layer. It builds a readable source map at `.switchbay/knowledge/index.json`, then automatically injects relevant snippets into Bay's turn context with file and line spans.

```bash
switchbay knowledge
switchbay knowledge refresh
switchbay knowledge search "approval gates"
```

Inside the TUI:

```text
/index
/index refresh
/search approval gates
```

The first backend is intentionally simple: line-based chunks, local lexical scoring, and normal path citations such as `README.md:120-160`. It indexes code, markdown/docs, config, memory, rules, engines, and Skills material. Embeddings or SQLite FTS can be added later without changing the way Bay consumes retrieved context.

## Trace Ledger

Trace Ledger is Switchbay's local flight recorder. Completed model turns write JSON receipts under `.switchbay/traces/` so Bay can show what it knew, what it touched, what tools ran, which approvals were staged, and what answer came back.

```bash
switchbay trace
switchbay trace export
switchbay radar
switchbay handoff
```

Inside the TUI:

```text
/trace
/trace last
/trace export
```

Trace v1 records the user prompt, runtime lane/tool mode, workspace branch, injected Workspace Knowledge sources, tool executions, changed files, pending shell approvals, rough prompt/answer token estimates, finish reason, and final answer.

## Quick Starts And Rules

Switchbay injects a compact Quick Starts and Rules block into Bay's system context. These guides act like small "read this first" packets before Bay uses a tool lane, edits a file type, or follows a custom workflow.

Built-in guides cover local tool use, Web Engine use, Switchbay MCP setup, Engine Bay calls, and local-first workspace boundaries. Add your own as markdown files:

```text
~/.switchbay/rules/*.rule.md
~/.switchbay/quickstarts/*.md
.switchbay/rules/*.rule.md
.switchbay/quickstarts/*.md
.switchbay/plugins/<id>/guides/*.md
```

TUI:

```text
/quickstarts
/rules
/rules create
/create-rule
```

Rules are created conversationally and default to `~/.switchbay/rules` so they follow you across projects. Choose `workspace` in the rule builder for repo-specific behavior.

## Engine Bay

Engine Bay is Switchbay's swappable tool layer. An engine is a small manifest that exposes another local project, script, harness, or agent module as model-callable tools.

Switchbay loads engines from:

- `.switchbay/engines/`
- `~/.switchbay/engines/`
- paths listed in `SWITCHBAY_ENGINE_PATHS`
- synced manifests from the GitHub Engine Bay cache

GitHub-backed hub:

```bash
switchbay engines
switchbay engines sync
switchbay engines list
switchbay engines templates
```

TUI:

```text
/engine-bay
/engine-bay sync
/engine-bay list
/engine-bay templates
/engines
```

By default, Engine Bay syncs from:

```text
https://github.com/genoventures-labs/Switchbay-Engines.git
```

into:

```text
~/.switchbay/engine-bay/Switchbay-Engines
```

Override with:

```bash
export SWITCHBAY_ENGINE_BAY_REPO=https://github.com/you/your-engine-bay.git
export SWITCHBAY_ENGINE_BAY_PATH=~/.switchbay/engine-bay/Switchbay-Engines
```

Template:

```json
{
  "id": "demo",
  "name": "Demo Engine",
  "description": "Tiny local helper engine.",
  "cwd": "/path/to/demo",
  "tools": [
    {
      "name": "say",
      "description": "Print text.",
      "command": "printf {{text}}",
      "parameters": {
        "text": { "type": "string", "description": "Text to print." }
      },
      "required": ["text"]
    }
  ],
  "approval": {
    "always": ["publish", "refund", "delete"]
  }
}
```

Generic engine tools exposed to the model:

- `list_engines`
- `list_engine_tools`
- `run_engine_tool`
- `validate_engines`

## Skills

Skills are Switchbay's reusable working-method layer. Engine Bay gives agents callable machinery; Skills give Bay reusable methods.

Skills are markdown files with frontmatter. They are human-readable, GitHub-syncable, and injected into session context as concise operating procedures.

Built-in skills include:

- `api-contract-check`
- `code-review-pass`
- `debugging-triage`
- `implementation-plan`
- `release-readiness`
- `test-strategy`
- `ui-polish-pass`
- `web-research`

CLI:

```bash
switchbay skills
switchbay skills sync
switchbay skills list
switchbay skills templates
switchbay skills read release-readiness
```

TUI:

```text
/skills
/skills sync
/skills list
/skills templates
/skills read release-readiness
```

The older `toolbox` command remains as a compatibility alias and as the internal cache/plugin namespace.

By default, Skills sync from:

```text
https://github.com/genoventures-labs/Engine-Toolboxes.git
```

into:

```text
~/.switchbay/toolbox/Engine-Toolboxes
```

Override with:

```bash
export SWITCHBAY_TOOLBOX_REPO=https://github.com/you/your-toolbox.git
export SWITCHBAY_TOOLBOX_PATH=~/.switchbay/toolbox/Engine-Toolboxes
```

Skill template:

```markdown
---
id: my-skill
name: My Skill
description: A reusable working method that Switchbay agents can apply during a session.
languages: [any]
agents: [any]
tags: [workflow]
triggers: [when this should be used]
---

# My Skill

## Use When

## Method

## Output

## Guardrails
```

Skills tools exposed to the model:

- `list_toolbox_skills`
- `read_toolbox_skill`
- `sync_toolbox`

## Plugins

Plugins are Switchbay's local bundle layer. A plugin is a plain `plugin.json` manifest under `.switchbay/plugins/<id>/` that can point to real assets inside that same plugin folder.

Plugins can include:

- `agents/*.md`
- `skills/*.skill.md`
- `engines/*.engine.json`
- `guides/*.md`
- `knowledge/*.md`, `knowledge/*.json`, or `knowledge/*.txt`
- `mcp/*.json`

CLI:

```bash
switchbay plugins
switchbay plugins list
switchbay plugins inspect repo-ops
```

TUI:

```text
/plugins
/plugins list
/plugins inspect repo-ops
/plugins create
/create-plugin
```

Plugin manifest:

```json
{
  "id": "repo-ops",
  "name": "Repo Ops",
  "description": "Repo hygiene agents, skills, and tools.",
  "version": "0.1.0",
  "enabled": true,
  "agents": ["agents/repo-steward.md"],
  "skills": ["skills/repo-check.skill.md"],
  "engines": ["engines/repo-tools.engine.json"],
  "guides": ["guides/repo-domain.md"],
  "knowledge": ["knowledge/quickstart.md"],
  "mcp": ["mcp/browser-tools.json"]
}
```

Switchbay validates plugin paths before loading them. Assets must be relative paths inside known plugin folders; absolute paths and `..` traversal are rejected. Plugin agents, skills, engines, and guides are merged into the normal drawers, tool inventories, and Quick Starts/Rules prompt block when the plugin is enabled.

Use plugin guides for domain-specific behavior. For example, a Gumroad plugin can include `guides/gumroad-domain.md` with `kind: quickstart` or `kind: rule` frontmatter so Bay knows to operate inside Gumroad-specific workflows, approval rules, terminology, and safety boundaries whenever that plugin's context is available.

## Web Engine

Switchbay includes a built-in guarded `web` engine for narrow, explicit-URL reads when Bay needs current docs, release notes, source pages, or public references. It is intentionally smaller than a browser lane: it does not invent searches, automate websites, or read private/internal addresses by default.

Web Engine tools:

- `web_tools`
- `web_fetch`
- `web_headers`
- `web_links`

TUI:

```text
/web
```

Guardrails:

- Only `http` and `https` URLs are allowed.
- Localhost, LAN, link-local, and private IP hosts are blocked by default.
- Responses are size-limited and converted to readable text where possible.
- Bay should cite the URL when web-fetched facts affect an answer.

For intentional internal testing, set `SWITCHBAY_WEB_ALLOW_PRIVATE=1` before launching Switchbay.

## Creative Engine

Switchbay includes a built-in `creative` engine for local writing support. It does not call an external model by itself; it gives the agent deterministic tools for briefs, naming, positioning, hooks, drafting, critique, voice notes, and content planning.

Creative outputs are saved under:

- `.switchbay/creative/briefs/`
- `.switchbay/creative/packets/`
- `.switchbay/creative/drafts/`
- `.switchbay/creative/voices/`

Drop markdown voice notes into `.switchbay/creative/voices/<voice>.md` and use `rewrite_voice` or `read_voice` to bring that style guide into a session.

Creative tools:

- `creative_tools`
- `creative_packet`
- `creative_brief`
- `name_storm`
- `positioning_routes`
- `hook_bank`
- `copy_draft`
- `rewrite_voice`
- `tighten_copy`
- `expand_idea`
- `critique_copy`
- `content_calendar`
- `list_voices`
- `read_voice`

Use `creative_packet` when you want one saved bundle containing a brief, positioning routes, names, hooks, draft copy, a short content calendar, and next moves.

## Built-In And Auto-Discovered Engines

### GumOps

GumOps is auto-discovered when Switchbay can find a GumOps checkout:

```bash
export SWITCHBAY_GUMOPS_PATH=/path/to/GumOps
export GUMROAD_ACCESS_TOKEN=...
```

Convenience tools include:

- `gumops_tools`
- `gumops_query`
- `gumops_refresh`
- `gumops_memory_list`
- `gumops_memory_get`
- `gumops_memory_add`
- `gumops_memory_find`
- `gumroad_products`
- `gumroad_sales_summary`
- `gumroad_account_info`
- `gumroad_refund_sale`

`gumroad_refund_sale` always stages explicit approval before execution.

When a GumOps checkout includes `engine_harnesses/fbgent.py` or `engine_harnesses/shopgent.py`, Switchbay also exposes read-only tools such as:

- `facebook_get`
- `facebook_page_insights`
- `shopify_shop_info`
- `shopify_products`
- `shopify_product`
- `shopify_orders`
- `shopify_order`
- `shopify_insights`

### Thinkapse

Thinkapse is auto-discovered as a local CLI-only engine when Switchbay can find a checkout:

```bash
export SWITCHBAY_THINKAPSE_PATH=/path/to/thinkapse
```

Switchbay intentionally skips Thinkapse HTTP/API/webhook surfaces. It exposes local harness tools such as:

- `capture`
- `query_unprocessed`
- `query_named`
- `triage`
- `route_preview`
- `route_apply`
- `agents`
- `agent_show`
- `agent_validate`
- `parse_notion_id`
- `suno_capture`
- `hellhound_capture`
- `msc_product_capture`
- `msc_order_capture`
- `msc_route_preview`
- `memory_status`
- `memory_context`

Preview, query, triage, agent inspection, and ID parsing run directly. Route apply, force capture, mark processed, create/edit/delete/apply-style operations stage approval first.

## Approval Model

Switchbay is built for private/internal use, so it avoids excessive hand-holding for normal local work. It still stages approval for commands with broad or irreversible impact, including patterns like:

- `rm`, `rmdir`
- `git push`, `git reset`, `git clean`
- `npm publish`, `bun publish`
- `sudo`, `chmod`, `chown`
- disk tools such as `dd`, `mkfs`, `fdisk`
- shell-piped remote scripts
- engine tools marked with `"approval": "always"`

## Development

Switchbay is Bun-first:

```bash
bun install
bun test
bun run build
```

Run from source:

```bash
bun index.tsx
```

Create a native binary:

```bash
bun build index.tsx --compile --outfile bin/switchbay-native
```

Release:

```bash
./scripts/release.sh 0.9.48
```

## License

MIT
