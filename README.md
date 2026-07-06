# Code Harness

A high-speed, **Bun**-powered terminal coding-agent shell. It is provider-neutral and runs with two model lanes:

- **cloud**: routes across OpenAI and Anthropic using local `.env` credentials.
- **local**: uses LM Studio as a local SLM utility lane.

## Runtime Config

Cloud lane:

```bash
export HARNESS_LANE=cloud
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export HARNESS_CLOUD_PROVIDER=auto # auto | openai | anthropic
```

Local lane:

```bash
export HARNESS_LANE=local
export HARNESS_LMSTUDIO_BASE=http://127.0.0.1:1234/v1
export HARNESS_LMSTUDIO_MODEL=qwen2.5-7b-instruct
```

Legacy `ORI_*` env vars are still read as fallbacks during the rename.

## The Stack

- **Runtime**: Bun
- **UI**: React + Ink
- **Layout**: Yoga

## Features

- **Cloud/Local Lanes**: Switch between API-backed intelligence and local LM Studio.
- **Local Tools**: File, shell, git, plan, agent, and workspace helpers execute from the harness.
- **Portable**: No runtime dependency on a private API or VPS.
- **Workspace Context**: Uses `HARNESS.md`, `.harness/memory.md`, and `.harness/pins.json`, with legacy `ORI.md` / `.ori` fallback.

## Local Development

```bash
bun install
bun run index.tsx
```

## Install As A Command

```bash
bun install
chmod +x ./bin/ori-code
bun link
```

Launch with:

```bash
code-harness
```

Legacy aliases `ori-code` and `ori` still work until the final brand rename lands.

Examples:

```bash
code-harness --mode build
code-harness --surface dev
code-harness --lane cloud
code-harness --lane local
code-harness "summarize this repo"
```
