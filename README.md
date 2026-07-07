# Switchbay

[![Version](https://img.shields.io/badge/version-0.9.46-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![UI](https://img.shields.io/badge/UI-React%20%2B%20Ink-2563eb)](https://github.com/vadimdemedes/ink)
[![Model lanes](https://img.shields.io/badge/lanes-cloud%20%7C%20local-16a34a)](#model-lanes)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay** is a terminal-first AI coding workbench for developers who want cloud intelligence, local control, and provider independence without rebuilding their workflow every time the stack changes.

It gives you one fast shell for agentic coding work: load repo context, talk through plans, inspect files, edit code, run commands, check git state, execute tests, manage sessions, and move between specialist agents for backend, UI, security, debugging, architecture, docs, and review.

Switchbay is not another IDE, hosted SaaS, or branded chatbot. It is the workbench around the model: the routing layer, context loader, local tool runner, memory system, session keeper, approval gate, and terminal cockpit that helps your coding workflow survive provider churn, outages, private backend changes, and unreliable internet.

Cloud when it helps. Local when it matters. Same rig either way.

## Why Switchbay

Most agentic coding tools make the model feel like the product. Switchbay treats intelligence as a set of lanes around your repo:

- Route high-complexity work through cloud models when you need deeper reasoning.
- Use LM Studio locally for small utility turns, offline-friendly work, or private machine-close tasks.
- Keep file inspection, edits, shell commands, git state, approvals, memory, and sessions visible in the terminal.
- Move between specialist agent modes without changing your whole workflow.
- Keep the harness useful even if a provider, VPS, hosted API, or backend changes underneath you.

Switchbay is built for solo builders, senior developers, and technical founders who live in the terminal and want the important parts of agentic coding close to the repo.

## Features

- **Cloud/local model lanes**: choose `cloud` or `local` per run, or set a default in your environment.
- **Cloud router**: use OpenAI, Anthropic, or automatic provider selection for high-intelligence work.
- **LM Studio lane**: point Switchbay at a local OpenAI-compatible LM Studio server for SLM utility work.
- **Terminal TUI**: React + Ink interface with transcript, composer, command drawer, mentions, sessions, and agent switching.
- **Repo context**: loads project context from `SWITCHBAY.md` and workspace memory from `.switchbay/`.
- **Local tools**: read files, inspect directories, run commands, check git, plan work, and apply edits from the shell.
- **Approval gate**: command execution stays visible and interruptible without turning every turn into hand-holding.
- **Sessions**: resume recent work with `/sessions`, `/resume`, or `switchbay --resume`.
- **Specialist agents**: built-in lanes for UI, backend, DevOps, debugging, architecture, security, docs, and review.
- **Compatibility fallbacks**: reads older `HARNESS_*`, `ORI_*`, `.harness/`, `.ori/`, `HARNESS.md`, and `ORI.md` names during the rename.

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
export SWITCHBAY_LMSTUDIO_BASE=http://127.0.0.1:1234/v1
export SWITCHBAY_LMSTUDIO_MODEL=qwen2.5-7b-instruct
```

Per command:

```bash
switchbay --lane cloud "review the auth flow"
switchbay --lane local "summarize the changed files"
```

## Install

Install with Homebrew once the tap is public:

```bash
brew tap genoventures-labs/tap
brew install ori-code
switchbay
```

The Homebrew formula is still named `ori-code` during the repository rename, but it installs the `switchbay` command. Legacy aliases `ori-code` and `ori` continue to work.

Local development install:

```bash
bun install
bun link
switchbay --help
```

## Usage

Interactive terminal UI:

```bash
switchbay
```

One-shot request:

```bash
switchbay "find the likely cause of the empty response bug"
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

## Workspace Files

Switchbay looks for:

- `SWITCHBAY.md`: persistent project context injected into coding sessions.
- `.switchbay/memory.md`: workspace memory.
- `.switchbay/pins.json`: pinned files and repo notes.
- `.switchbay/agents/*.md`: custom local specialist agents.

Compatibility reads are still enabled for:

- `HARNESS.md`, `ORI.md`
- `.harness/`, `.ori/`
- `HARNESS_*`, `ORI_*` environment variables
- `~/.code-harness/`, `~/.ori/` global config

New writes use the Switchbay names.

## Commands

Inside the TUI:

```text
/help        Show commands
/sessions    List recent sessions
/resume      Resume a saved session
/purge 1w    Clean old sessions
/agent       Switch specialist agent
/new-agent   Create a custom agent
/plan        Generate a plan
/status      Show git/workspace state
```

CLI helpers:

```bash
switchbay --help
switchbay version
switchbay update
```

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

## Status

Switchbay is an active rename and normalization pass from the older ORI-Code / code-harness project. The current focus is stabilizing the provider-neutral shell, cleaning API lanes, tightening approval gates, and preparing the public Homebrew path.

## License

MIT
