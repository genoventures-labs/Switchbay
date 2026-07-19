# Switchbay

[![Version](https://img.shields.io/badge/version-1.6.30-111827)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-0f766e)](#license)

**Switchbay is a model management system for working across local and cloud AI runtimes.**

Add models from any provider, switch between runtimes mid-session, benchmark and trust-grade your pool, and run the same agent against whichever model fits the task — without reconfiguring anything.

```bash
brew tap genoventures-labs/tap
brew install switchbay
switchbay
```

<img src="assets/screenshots/help.svg" width="100%" alt="switchbay --help"/>

---

## Models

Switchbay keeps a central catalog of the models you've added. No presets — only models you explicitly register.

```bash
switchbay model add claude-opus-4-8       # add to cloud catalog
switchbay model add gemini-2.5-pro        # works with any configured provider
switchbay model pull llama3.2 -y          # pull local model via Ollama
switchbay models                          # browse your catalog
switchbay models --provider anthropic     # filter by provider
switchbay model remove --lane openai      # bulk remove a provider's models
switchbay models clear                    # clear all
```

<img src="assets/screenshots/models.svg" width="100%" alt="switchbay models"/>

---

## Runtimes

Switch between cloud and local inference without touching your session or context.

| Lane | Providers |
|---|---|
| `cloud` | OpenAI · Anthropic · Google — auto-routed or pinned |
| `local` | Ollama · llama.cpp · MLX |
| `apple` | AFM 3 Core · Core Advanced · Cloud · Cloud Pro (PCC) |
| `openrouter` | OpenRouter |
| `huggingface` | HF Inference Providers |

```bash
switchbay --lane local "summarise this file"    # route to local
switchbay --lane cloud "review this PR"         # route to cloud
```

Lane flags, env vars, or `/lane` mid-session — all work the same way.

---

## Benchmarking

Run a pre-bench across your entire model catalog to grade each model before you rely on it. Grades are stored and shown alongside your model list.

```bash
switchbay benchmark --pre          # grade all models (A+ → F)
switchbay models --trusted         # show only A/B models
switchbay benchmark <model-id>     # full 10-test suite on one model
```

Grades are based on coherence, instruction-following, JSON output, tool calls, safety, and more. Failed due to auth or network errors are flagged separately from genuine low scores.

---

## Agent workspace

Switchbay runs a persistent agent with tools, memory, and context that carries across sessions.

```bash
switchbay                              # open the terminal workspace
switchbay "find the auth bug"          # one-shot request
switchbay --resume                     # continue your last session
switchbay open                         # open the visual web workspace
switchbay serve                        # start the local API server
```

The agent extends through **engines** (JSON tool manifests), **skills** (working methods), and **agents** (specialist personas) — none of which require touching core code.

```bash
switchbay sync                         # sync engines and skills from remote
switchbay engines list
switchbay skills list
switchbay agents list
```

Full reference: [docs/](docs/)

---

MIT
