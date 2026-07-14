# Plugins

Plugins are Switchbay's local bundle layer. A plugin is a plain `plugin.json` manifest under `.switchbay/plugins/<id>/` that groups related agents, skills, engines, guides, knowledge, and MCP configs into one portable unit.

Everything in a plugin loads automatically when the plugin is enabled — no registration steps, no code changes.

## Plugin Manifest

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

All paths are relative to the plugin folder. Absolute paths and `..` traversal are rejected for security.

## What a Plugin Can Include

| Asset Type | Path Pattern | Effect |
|---|---|---|
| Agents | `agents/*.md` | Loaded into the agent drawer |
| Skills | `skills/*.skill.md` | Merged into the skills inventory |
| Engines | `engines/*.engine.json` | Discovered and registered automatically |
| Guides | `guides/*.md` | Injected into Quick Starts / Rules block |
| Knowledge | `knowledge/*.md`, `*.json`, `*.txt` | Available for Workspace Knowledge indexing |
| MCP config | `mcp/*.json` | Merged into the Switchbay MCP bridge config |

## CLI

```bash
switchbay plugins
switchbay plugins list
switchbay plugins inspect repo-ops
```

## TUI

```text
/plugins
/plugins list
/plugins inspect repo-ops
/plugins create
/create-plugin
```

## Creating a Plugin

Use the conversational builder:

```text
/create-plugin
```

Or create the folder and `plugin.json` manually:

```bash
mkdir -p .switchbay/plugins/my-plugin/agents
mkdir -p .switchbay/plugins/my-plugin/skills
```

Save your `plugin.json` and Switchbay discovers it automatically on the next session start.

## Plugin Guides

Use plugin guides for domain-specific behavior. For example, a plugin for a specific service can include `guides/domain.md` with `kind: quickstart` or `kind: rule` frontmatter so Switchbay automatically operates inside that service's workflows, approval rules, terminology, and safety boundaries when the plugin is active.

```markdown
---
kind: quickstart
title: Gumroad Domain
---

When working in this workspace, always confirm before issuing refunds.
Use the `gumops_query` tool for operations questions rather than guessing.
```
