# Switchbay MCP Bridge

The Switchbay MCP bridge is a full MCP client runtime shared by cloud models, Ollama, the TUI, CLI, local API, and SDK. It connects to local stdio servers or remote Streamable HTTP endpoints, initializes each server, discovers tools with `tools/list`, exposes namespaced tools to Switchbay, and executes `tools/call` through Switchbay policy.

---

## What It Is (and Isn't)

| | Switchbay MCP Bridge | MCP Server |
|---|---|---|
| Role | MCP host/client | Provides tools |
| Transports | stdio and Streamable HTTP | stdio or Streamable HTTP |
| Config | `~/.switchbay/mcp.json` | Server-specific |
| Models | Every Switchbay model lane | Model-independent |
| Safety | allowlists, HTTPS/loopback rules, timeouts, approval policy | Server annotations are untrusted input |

Discovered tools are exposed as `mcp__<server>__<tool>` to prevent collisions. A configured server defaults to `approval: "always"`, which blocks execution; set `approval: "auto"` only after reviewing the server and its allowed tools.

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

When the bridge is active, Switchbay's system prompt includes a `SWITCHBAY MCP BRIDGE` block listing the current model lane, config path, and configured integrations. Switchbay uses this to know which tool intents are allowed.

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

Switchbay uses only the canonical `~/.switchbay/mcp.json` configuration.

### Config Format

```json
{
  "enabled": true,
  "mcpServers": {
    "local-tools": {
      "command": "bunx",
      "args": ["@example/local-mcp-server", "/path/to/allowed/workspace"],
      "allowed_tools": ["read_file", "search"],
      "approval": "auto",
      "timeout_ms": 30000
    },
    "github": {
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_MCP_TOKEN}"
      },
      "allowed_tools": ["get_issue", "list_pull_requests"],
      "approval": "auto"
    }
  }
}
```

Each server must define exactly one transport: `command` for stdio or `url` for Streamable HTTP. Remote URLs require HTTPS; plain HTTP is accepted only for loopback hosts. `${ENV_VAR}` placeholders are expanded in URLs, arguments, headers, and server environment without printing resolved secrets.

---

## Safety Policy

- `allowed_tools` is enforced after discovery and again by the namespaced reverse map.
- Tool descriptions and annotations never override Switchbay policy.
- Calls are denied unless the server explicitly opts into `approval: "auto"`.
- Connections and calls have bounded timeouts; returned content is size-limited.
- Server processes and HTTP sessions are closed at the end of the turn.
- Failed servers produce warnings and do not disable ordinary local tools.

---

## Setting Up a Config

**TUI — conversational builder:**

```text
/create-mcp
```

Switchbay asks what you want to use, matches it against the trusted catalog, and generates the config file. You review and approve it before it's saved.

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

## How Switchbay Uses It

When `switchbay-mcp` tool mode is active, Switchbay injects this into Switchbay's system prompt:

```text
SWITCHBAY MCP BRIDGE:
Model lane: cloud
Config: ~/.switchbay/mcp.json
Switchbay owns MCP/tool execution for this turn.
Configured MCP servers are initialized and their allowed tools are exposed as namespaced model tools.
Configured MCP integrations:
- mcp/playwright
- mcp/filesystem

Switchbay MCP bridge rules:
- Use only tools actually returned by MCP discovery.
- If a requested MCP server fails connection or has no allowed matching tool, say exactly what is missing.
- Do not invent MCP server ids, tool names, plugin handles, or external capabilities.
```

Switchbay receives the discovered definitions alongside Switchbay's local tools and engine tools. MCP execution results return through the same tool-message loop, so the model can continue the turn using real server output.

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
/create-mcp        Conversational builder — describe what you want, Switchbay generates the config
```

```bash
switchbay mcp status
switchbay mcp init
switchbay mcp catalog
```
