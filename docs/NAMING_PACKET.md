# Naming Packet

## Working Description

A terminal-first coding agent harness that stays useful even when any single private backend, hosted API, or local model setup is unavailable. It gives a developer one shell for agentic coding work, then lets them choose between a high-intelligence cloud lane and a local LM Studio lane.

## Core Idea

This is not a model, a hosted platform, or a proprietary runtime. It is the **workbench around the model**: context loading, local tools, shell access, git-aware safety, sessions, agent modes, memory, plans, and provider routing.

The product promise is portability: the user’s coding workflow should not become useless because one VPS, model provider, or hosted service goes down.

## What It Does

- Runs as a fast Bun-powered terminal UI.
- Lets the user chat with an agent about a local codebase.
- Executes local tools: read files, edit files, search, run shell commands, inspect git state, run tests/builds, and manage checkpoints.
- Supports two runtime lanes:
  - **cloud**: routes between OpenAI and Anthropic based on task shape.
  - **local**: talks to LM Studio for local SLM utility work.
- Maintains local session history.
- Loads persistent workspace context from `HARNESS.md`.
- Supports workspace memory and pinned files in `.harness/`.
- Supports specialist agents like backend, UI, security, debugger, architect, docs, and reviewer.
- Keeps approvals focused on risky commands instead of hand-holding every normal development action.

## Who It Is For

Primary audience:
- Solo builders and senior developers who live in the terminal.
- Developers who want AI coding help without being locked into one provider.
- People who need a local fallback when cloud APIs, private servers, or internet access are unreliable.

Secondary audience:
- Technical founders maintaining many small repos.
- Power users who want agentic workflows but still want transparent local tool execution.
- Developers experimenting with local models alongside frontier APIs.

## User Psychology

They do not want another IDE, dashboard, or “AI workspace.”

They want:
- Control.
- Speed.
- Portability.
- A useful assistant that can actually touch the repo.
- Confidence that their workflow survives provider churn.
- Less ceremony than enterprise copilots.
- More local agency than hosted chat.

## Positioning Angles

- **Portable AI coding harness**: bring your own models, keep your workflow.
- **Terminal workbench for agentic coding**: the shell around cloud and local intelligence.
- **Model-agnostic coding cockpit**: OpenAI, Anthropic, and LM Studio as lanes, not lock-in.
- **Local-first agent shell**: repo context and tools stay on the machine.
- **Survivalist dev tool**: still useful when the mothership goes dark.
- **AI pit crew for the terminal**: the model changes, the workflow remains.

## What It Is Not

- Not a hosted SaaS.
- Not a model provider.
- Not an IDE replacement.
- Not a public competitor to Claude Code or Codex.
- Not an ORI API client anymore.
- Not a branding-heavy assistant persona.

## Tone To Name Toward

Good names may feel:
- Durable
- Mechanical
- Portable
- Sharp
- Workshop-like
- Terminal-native
- Slightly rebellious
- Useful before they are cute

Avoid names that feel:
- Overly mystical
- Too enterprise
- Too chatbot-like
- Too cute
- Too bound to one model/provider
- Too ORI-specific

## Useful Metaphors

- Harness
- Workbench
- Rig
- Console
- Switchboard
- Cockpit
- Toolkit
- Relay
- Router
- Forge
- Bay
- Bench
- Frame
- Shell
- Lane

## One-Sentence Pitch Options

- A terminal coding harness that lets you route work between frontier APIs and local models without rebuilding your workflow.
- A local-first agent shell for developers who want cloud intelligence, local tools, and provider independence in one TUI.
- A portable AI coding workbench: OpenAI when it helps, Anthropic when it fits, LM Studio when you want local.
- The coding-agent shell that keeps working when the backend, provider, or internet plan changes.

## Current Working Names In Code

- App label: `Code Harness`
- Command alias: `code-harness`
- Workspace context file: `HARNESS.md`
- Workspace data directory: `.harness/`
- Global config directory: `~/.code-harness/`

These are placeholders, not final brand recommendations.
