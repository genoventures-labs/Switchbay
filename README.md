# Switchbay

[![Version](https://img.shields.io/badge/version-0.9.79-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![UI](https://img.shields.io/badge/UI-React%20%2B%20Ink-2563eb)](https://github.com/vadimdemedes/ink)
[![Model lanes](https://img.shields.io/badge/lanes-cloud%20%7C%20local%20%7C%20MCP-16a34a)](#model-lanes)
[![Engine Bay](https://img.shields.io/badge/Engine%20Bay-GitHub%20sync-7c3aed)](#engine-bay)
[![Toolbox](https://img.shields.io/badge/Toolbox-agent%20skills-0f766e)](#toolbox)
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
- Create files, edit files, run commands, execute tests, and build locally.
- Move between specialist agents for backend, UI, security, debugging, architecture, docs, and review.
- Resume sessions, pin context, save local memories, and keep work visible in the terminal.
- Route between cloud models and local LM Studio models without changing the workflow.
- Enable Switchbay's MCP bridge for cloud or local models that should use configured tool workflows.
- Add swappable engines from local manifests or the GitHub-backed Engine Bay.
- Give agents reusable Toolbox skills for review, debugging, planning, testing, API checks, UI polish, and releases.

Switchbay is built for solo builders, senior developers, technical founders, and internal-tool people who live in the terminal and want the useful parts of AI coding close to the repo.

## Why It Exists

Most AI coding tools make one model, hosted service, or private backend feel like the product. Switchbay treats intelligence as a set of lanes.

- Use cloud models for deeper reasoning, code review, architecture, and complex implementation.
- Use local LM Studio models for smaller utility work, offline-friendly tasks, private machine-close work, and quick summaries.
- Enable Switchbay's MCP bridge when cloud or local models should use configured tool intent through Switchbay's own local tool bridge.
- Keep approvals practical: broad-impact, destructive, privileged, publishing, refunding, and deploy-style actions still gate.
- Keep the workbench useful even if a provider, hosted API, VPS, or local model setup changes.
- Keep extensions portable through Engine Bay instead of baking every workflow into the core app.
- Keep reusable agent methods portable through Toolbox instead of hiding them in one-off prompts.

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
export SWITCHBAY_CLOUD_PROVIDER=auto # auto | openai | anthropic
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

Local LM Studio lane:

```bash
export SWITCHBAY_LANE=local
export SWITCHBAY_LMSTUDIO_BASE=http://192.168.1.50:1234/v1 # use your LM Studio host
export SWITCHBAY_LMSTUDIO_API_KEY=... # generate in LM Studio when MCP/tool access is gated
export SWITCHBAY_LMSTUDIO_MODEL=qwen2.5-7b-instruct
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

Inside the TUI, use `/lane` to cycle Cloud and LM Studio model lanes, `/mcp on` to enable Switchbay's MCP bridge under the active model lane, `/mcp off` to disable it, and `/lane native-mcp` only when testing LM Studio's native MCP API. Cloud models use built-in OpenAI/Anthropic presets; LM Studio models are fetched from `SWITCHBAY_LMSTUDIO_BASE`. Use `/mcp init` for an empty starter config, `/mcp catalog` to list trusted MCP options, or `/create-mcp` for the conversational MCP config builder.

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
switchbay engines sync
switchbay toolbox list
switchbay memory refresh
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
/lane              Cycle Cloud and LM Studio model lanes
/model             Pick a cloud preset or LM Studio model
/init              Generate SWITCHBAY.md for this repo
/pin               Pin a file into future turn context
/pins              List pinned files
/remember          Save a workspace memory note
/memories          List workspace memory notes
/memory            Show or refresh operational memory
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
/create-skill      Create a custom Toolbox skill
/create-mcp        Create a custom Switchbay MCP bridge config
/edit              Open the file edit picker
/engines           List registered engines
/create-engine     Create a custom workspace engine manifest
/engine-bay        Show or sync the GitHub engine hub
/creative          Show the built-in Creative Engine lane
/toolbox           Show or sync reusable agent skills
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
- `.switchbay/pins.json`: pinned files and repo notes.
- `.switchbay/agents/*.md`: custom local specialist agents.
- `.switchbay/engines/*.engine.json`: workspace engine manifests.
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

## Quick Starts And Rules

Switchbay injects a compact Quick Starts and Rules block into Bay's system context. These guides act like small "read this first" packets before Bay uses a tool lane, edits a file type, or follows a custom workflow.

Built-in guides cover local tool use, Web Engine use, Switchbay MCP setup, Engine Bay calls, and local-first workspace boundaries. Add your own as markdown files:

```text
~/.switchbay/rules/*.rule.md
~/.switchbay/quickstarts/*.md
.switchbay/rules/*.rule.md
.switchbay/quickstarts/*.md
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

Engine Bay is Switchbay's swappable toolbox layer. An engine is a small manifest that exposes another local project, script, harness, or agent module as model-callable tools.

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

## Toolbox

Toolbox is Switchbay's reusable skill layer. Engine Bay gives agents callable machinery; Toolbox gives agents working methods.

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
switchbay toolbox
switchbay toolbox sync
switchbay toolbox list
switchbay toolbox templates
switchbay toolbox read release-readiness
```

TUI:

```text
/toolbox
/toolbox sync
/toolbox list
/toolbox templates
/toolbox read release-readiness
/skills
/skills sync
```

By default, Toolbox syncs from:

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

Toolbox tools exposed to the model:

- `list_toolbox_skills`
- `read_toolbox_skill`
- `sync_toolbox`

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
