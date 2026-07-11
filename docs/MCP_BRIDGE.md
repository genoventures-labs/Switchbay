# Switchbay MCP Bridge

The Switchbay MCP bridge is Switchbay's own tool-intent layer. It lets you tell a cloud or local model that certain MCP-style capabilities (browser, filesystem, GitHub, etc.) are available — and routes those tool calls through Switchbay's local tool bridge, not through a third-party MCP server runtime.

It is **not** a full MCP protocol implementation. It is a config-driven intent map: you declare what integrations are available, Bay knows to use them, and Switchbay handles execution locally.

---

## What It Is (and Isn't)

| | Switchbay MCP Bridge | Full MCP Server |
|---|---|---|
| Protocol | Switchbay's own tool bridge | Model Context Protocol spec |
| Execution | Runs locally via Switchbay | External server process |
| Config | `~/.switchbay/mcp.json` | Per-app server config |
| Models | Cloud and local | Depends on the server |
| Trusted IDs | Curated catalog only | Any server you define |

The bridge tells Bay *what* is conceptually available. Switchbay then executes it through the same local tool bridge it uses for everything else — file reads, shell commands, engine calls — no extra daemon needed.

---

## Enabling the Bridge

**Environment variable:**

```bash
export SWITCHBAY_TOOL_MODE=switchbay-mcp
# or any of:
# SWITCHBAY_TOOL_MODE=mcp
# SWITCHBAY_TOOL_MODE=on
# SWITCHBAY_TOOL_MODE=bridge
```

**Per-command:**

```bash
SWITCHBAY_MCP=on switchbay --lane cloud "use the browser tools to check this URL"
```

**Cloud-MCP lane alias** (cloud + bridge always on):

```bash
export SWITCHBAY_LANE=cloud-mcp
```

**TUI:**

```text
/mcp on            Enable the bridge for this session
/mcp off           Disable the bridge for this session
/mcp               Show current config and status
```

When the bridge is active, Bay's system prompt includes a `SWITCHBAY MCP BRIDGE` block listing the current model lane, config path, and configured integrations. Bay uses this to know which tool intents are allowed.

---

## Config File

The config lives at:

```text
~/.switchbay/mcp.json
```

Override with:

```bash
export SWITCHBAY_MCP_CONFIG=/path/to/your/mcp.json
```

**Backward compat:** If `mcp.json` doesn't exist but `~/.switchbay/lmstudio.mcp.json` does, Switchbay loads that automatically.

### Config Format

```json
{
  "enabled": true,
  "integrations": [
    "mcp/playwright",
    "mcp/filesystem",
    "mcp/github"
  ],
  "mcpServers": {
    "playwright": {
      "name": "Playwright",
      "description": "Browser automation, page inspection, screenshots, and basic web testing."
    },
    "filesystem": {
      "name": "Filesystem",
      "description": "Scoped file and directory access through an MCP server."
    }
  }
}
```

`integrations` is the canonical list Bay reads. `mcpServers` is an optional metadata block — Switchbay derives the integration list from either field, preferring `integrations` when both are present.

---

## Trusted Catalog

Bay will only generate configs from the trusted catalog. It will not invent server IDs, plugin handles, or capabilities that aren't in this list.

| Integration ID | Name | Description |
|---|---|---|
| `mcp/playwright` | Playwright | Browser automation, page inspection, screenshots, and basic web testing |
| `mcp/filesystem` | Filesystem | Scoped file and directory access |
| `mcp/github` | GitHub | Repository, issue, and pull-request workflows |
| `mcp/memory` | Memory | Simple persistent memory |
| `mcp/fetch` | Fetch | HTTP fetch/read access for URLs |
| `mcp/sequential-thinking` | Sequential Thinking | Structured step-by-step planning |
| `mcp/postgres` | Postgres | Read/query Postgres databases |

If you request something outside this list, Bay refuses and tells you to add the integration ID manually to `~/.switchbay/mcp.json` instead of hallucinating one.

---

## Setting Up a Config

**TUI — conversational builder:**

```text
/create-mcp
```

Bay asks what you want to use, matches it against the trusted catalog, and generates the config file. You review and approve it before it's saved.

**TUI — generate an empty starter:**

```text
/mcp init
```

**Browse the catalog:**

```text
/mcp catalog
```

```bash
switchbay mcp catalog
```

**Check current status:**

```text
/mcp
```

```bash
switchbay mcp status
```

---

## How Bay Uses It

When `switchbay-mcp` tool mode is active, Switchbay injects this into Bay's system prompt:

```text
SWITCHBAY MCP BRIDGE:
Model lane: cloud
Config: ~/.switchbay/mcp.json
Switchbay owns MCP/tool execution for this turn.
Use Switchbay's local tool bridge for tool execution and treat configured MCP integrations as allowed tool intent.
Configured MCP integrations:
- mcp/playwright
- mcp/filesystem

Switchbay MCP bridge rules:
- If the user asks for configured MCP/browser/file/fetch behavior, use the matching Switchbay tool calls when available.
- If a requested MCP server is not configured or no matching Switchbay bridge tool exists, say exactly what is missing.
- Do not invent MCP server ids, tool names, plugin handles, or external capabilities.
```

Bay reads this before any tool work. It knows what's allowed, executes through Switchbay's bridge, and tells you plainly if something isn't configured rather than making it up.

---

## Integration Types

The `integrations` array supports three forms:

**Simple string** (most common):

```json
"integrations": ["mcp/playwright", "mcp/github"]
```

**Plugin-scoped integration:**

```json
{
  "type": "plugin",
  "id": "my-plugin-id",
  "allowed_tools": ["specific_tool"]
}
```

**Ephemeral/external MCP server** (advanced):

```json
{
  "type": "ephemeral_mcp",
  "server_label": "My Server",
  "server_url": "https://my-mcp-server.example.com",
  "allowed_tools": ["tool_a", "tool_b"],
  "headers": { "Authorization": "Bearer ..." }
}
```

---

## TUI Commands Summary

```text
/mcp               Show bridge status and current config path
/mcp on            Enable the Switchbay MCP bridge for this session
/mcp off           Disable the Switchbay MCP bridge for this session
/mcp catalog       List all trusted integration options
/mcp init          Generate an empty starter config
/create-mcp        Conversational builder — describe what you want, Bay generates the config
```

```bash
switchbay mcp status
switchbay mcp init
switchbay mcp catalog
```
