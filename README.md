# ORI-Code

A high-speed, **Bun**-powered **terminal UI (TUI)** for working with **ORI** as a **coding agent**: agents and sovereign operators who live in the console, not the browser. It targets the same **`glm.thynaptic.com`** backbone as other first-party ORI clients and maps to the **`ori_code`** dev surface in ORI product manifests.

**Product topology:** ORI-Code is documented alongside the rest of the ORI line in the main platform repo — see **`docs/PRODUCTS.md`** in [Mavaia](https://github.com/thynaptic/oricli-alpha) (canonical ID `ori_code`, sibling repo path `../ori-code` next to the platform clone).

## The Stack
- **Runtime**: [Bun](https://bun.sh) (Insanely fast startup and execution)
- **UI**: React + Ink (Reactive, state-driven terminal components)
- **Layout**: Yoga (Constraint-based flexbox rendering)

## Features
- **Big Sister Persona**: Native support for Flagship sass and protective wit.
- **Live Sync**: Heartbeat connection to the Go backbone for real-time status.
- **Zero-Beige**: Strictly follows the Sovereign Spine rules. No apologies, no choice menus.
- **Portable**: Run directly from the source or compile to a standalone binary.

## Quick Start (Mac/Linux)

Run the flagship terminal interface in one go:

```bash
curl -s https://dev.thynaptic.com/tui.tsx | bun run -
```

## Local Development

```bash
# Install dependencies
bun install

# Run in watch mode
bun run index.tsx
```

## Install As A Command

To run it as `ori-code` from anywhere on your Mac:

```bash
cd /Users/cass/Documents/GitHub/ori-code
bun install
chmod +x ./bin/ori-code
bun link
```

Then you can launch it with:

```bash
ori-code
```

You can still pass normal arguments:

```bash
ori-code --mode build
ori-code --surface dev
ori-code "summarize this repo"
```

---

*Built in the Shadowlab for the Sovereign Agent OS — Thynaptic Research.*
