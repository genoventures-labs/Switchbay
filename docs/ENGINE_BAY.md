# Engine Bay

Engine Bay is Switchbay's swappable tool layer. An engine is a small JSON manifest that exposes another local project, script, harness, or agent module as model-callable tools. No code changes, no restarts — drop a manifest and Bay gains new capabilities.

## How Engines Are Discovered

Switchbay auto-discovers engines from the following locations (in order):

- `.switchbay/engines/` — workspace-local manifests
- `~/.switchbay/engines/` — user-global manifests
- Paths listed in `SWITCHBAY_ENGINE_PATHS` (colon-separated)
- Synced manifests from the GitHub Engine Bay cache

## GitHub Engine Bay

A GitHub-backed hub of community engine templates that you can sync locally:

```bash
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

into `~/.switchbay/engine-bay/Switchbay-Engines`. Override with:

```bash
export SWITCHBAY_ENGINE_BAY_REPO=https://github.com/you/your-engine-bay.git
export SWITCHBAY_ENGINE_BAY_PATH=~/.switchbay/engine-bay/Switchbay-Engines
```

## Engine Manifest Format

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

Use `{{param}}` template syntax in `command` to interpolate model-provided arguments. Commands in the `approval.always` list are always staged for user approval before execution.

## Generic Engine Tools (Always Available)

These tools are always available to the model for working with any engine:

| Tool | Description |
|---|---|
| `list_engines` | List all discovered engines and their status |
| `list_engine_tools` | List the tools exposed by a specific engine |
| `run_engine_tool` | Execute a tool from a discovered engine |
| `validate_engines` | Validate engine manifests for errors |

## Creating a Custom Engine

Use the conversational builder:

```text
/create-engine
```

Or save a manifest directly to `.switchbay/engines/my-engine.engine.json` — it will be discovered automatically on the next turn.

## Built-In Engines

### Web Engine

A guarded engine for narrow, explicit-URL reads when Bay needs current docs, release notes, or public references. It does not invent searches or automate websites.

Tools: `web_tools`, `web_fetch`, `web_headers`, `web_links`

Guardrails:
- Only `http` and `https` URLs allowed
- Localhost, LAN, link-local, and private IPs blocked by default
- Responses are size-limited and converted to readable text
- Bay cites the URL when web-fetched facts affect an answer

For intentional internal testing: `SWITCHBAY_WEB_ALLOW_PRIVATE=1`

TUI: `/web`

### Creative Engine

A local writing support engine. Does not call an external model — gives the agent deterministic tools for briefs, naming, positioning, hooks, drafting, critique, voice notes, and content planning.

Creative outputs are saved under:
- `.switchbay/creative/briefs/`
- `.switchbay/creative/packets/`
- `.switchbay/creative/drafts/`
- `.switchbay/creative/voices/`

Drop markdown voice notes into `.switchbay/creative/voices/<voice>.md` and use `rewrite_voice` or `read_voice` to bring that style guide into a session.

Tools: `creative_tools`, `creative_packet`, `creative_brief`, `name_storm`, `positioning_routes`, `hook_bank`, `copy_draft`, `rewrite_voice`, `tighten_copy`, `expand_idea`, `critique_copy`, `content_calendar`, `list_voices`, `read_voice`

Use `creative_packet` when you want one saved bundle containing a brief, positioning routes, names, hooks, draft copy, a short content calendar, and next moves.

## Auto-Discovered Engines

### GumOps

GumOps is auto-discovered when Switchbay can find a GumOps checkout:

```bash
export SWITCHBAY_GUMOPS_PATH=/path/to/GumOps
export GUMROAD_ACCESS_TOKEN=...
```

Tools exposed: `gumops_tools`, `gumops_query`, `gumops_refresh`, `gumops_memory_list`, `gumops_memory_get`, `gumops_memory_add`, `gumops_memory_find`, `gumroad_products`, `gumroad_sales_summary`, `gumroad_account_info`, `gumroad_refund_sale`

> `gumroad_refund_sale` always stages explicit approval before execution.

When a GumOps checkout includes `engine_harnesses/fbgent.py` or `engine_harnesses/shopgent.py`, Switchbay also exposes read-only tools: `facebook_get`, `facebook_page_insights`, `shopify_shop_info`, `shopify_products`, `shopify_product`, `shopify_orders`, `shopify_order`, `shopify_insights`

### Thinkapse

Thinkapse is auto-discovered as a local CLI-only engine when Switchbay can find a checkout:

```bash
export SWITCHBAY_THINKAPSE_PATH=/path/to/thinkapse
```

Switchbay intentionally skips Thinkapse HTTP/API/webhook surfaces and exposes only local harness tools: `capture`, `query_unprocessed`, `query_named`, `triage`, `route_preview`, `route_apply`, `agents`, `agent_show`, `agent_validate`, `parse_notion_id`, `suno_capture`, `hellhound_capture`, `msc_product_capture`, `msc_order_capture`, `msc_route_preview`, `memory_status`, `memory_context`

Preview, query, triage, agent inspection, and ID parsing run directly. Route apply, force capture, and create/edit/delete/apply-style operations stage approval first.
