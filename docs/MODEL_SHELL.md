# Model Shell

Every turn in Switchbay runs inside a constructed environment — a shell the model operates in. This doc describes exactly what that environment contains, what the model can see, what it can do, and what gates exist around high-impact actions.

---

## What the model receives per turn

When a turn starts, Switchbay builds a system prompt and hands it to the model alongside the session transcript and the user's message. The model sees everything in the system prompt upfront — it does not need to request context.

### Always present

| Block | Contents |
|---|---|
| **Operating header** | Current mode, profile, workspace path, date, runtime lane, tool mode |
| **Identity rule** | The model speaks as itself. Switchbay owns the shell, tools, and standards — the model is not a fictional assistant persona |
| **Workspace snapshot** | Pre-fetched: top-level file listing (up to 40 entries), `package.json` summary (name, scripts, deps), git working tree status, last 5 commits |
| **Grounding rules** | 12 explicit rules the model must follow — stay scoped to the workspace, don't fabricate repo state, use the right tool for typed data, ask before crossing workspace boundaries |
| **Tool use rules** | What runs immediately vs. what requires approval; instructions to chain tool calls; reminder that the tool bridge is always live |
| **Capability directory** | A full listing of available agents, skills, engines, plugins, and MCP integrations at turn time |
| **Shared authoring roots** | Paths to the shared engine/skill/plugin repos — used when creating reusable assets |

### Conditionally present

| Block | When it appears |
|---|---|
| **`SWITCHBAY.md` / project context** | When `SWITCHBAY.md` (or legacy `ORI.md`) exists in the workspace root |
| **User context** | When `~/.switchbay/user-context/` files exist — personal facts about the user across all sessions |
| **Workspace profile** | When `.switchbay/workspace-profile.md` exists — project-specific standing context |
| **Pinned files** | When `.switchbay/pins.json` exists — up to 10 files, each read and embedded in full (capped at 3,000 chars each) |
| **Active plan** | When a step-by-step plan is in progress — the model works through it sequentially |
| **Workflows** | When `.switchbay/workflows/` contains saved workflow definitions |
| **Active agent** | When a specialist agent is selected — its full persona and instructions are injected |
| **Toolbox (skills)** | Always listed in the capability directory; individual skills read on demand via `read_toolbox_skill` |
| **MCP integrations** | When `switchbay-mcp` tool mode is active — integration labels and config path are embedded |
| **Subtask context** | When the turn is spawned by a parent agent via `spawn_agent` — the parent's context is passed down |

---

## Tool bridge

The model does not execute anything directly. Every action goes through Switchbay's tool bridge — the model calls a named tool, Switchbay executes it locally, and the result is returned.

### File system

| Tool | What it does |
|---|---|
| `read_file` | Read a file in full |
| `read_file_range` | Read a specific line range |
| `read_json` | Read and pretty-print a JSON file |
| `summarize_file` | File metadata + leading lines |
| `list_directory` | Directory listing, optionally recursive |
| `glob_files` | Find files by name or glob pattern |
| `search_files` | Regex search across the project via ripgrep |
| `create_file` | Create a new file |
| `write_file` | Overwrite a file |
| `apply_patch` | Targeted string replacement — safer than full rewrites |

### Shell

| Tool | What it does |
|---|---|
| `shell` | Run a shell command on the local machine |

The `shell` tool has two tiers:

- **Immediate** — read-only commands (`ls`, `cat`, `grep`, `find`, `curl GET`, etc.) and routine workspace work (edits, `mkdir`/`mv`/`cp`, installs, builds, tests, `git add`, `git commit`) run without prompting.
- **Approval required** — the model sets `requires_approval: true`, or the command matches a hard pattern: `rm`, `rmdir`, `git push`, `git reset`, `git clean`, `npm publish`, `bun publish`, `sudo`, `chmod`, `chown`, `dd`, `mkfs`, `fdisk`, or `curl`/`wget` piped to a shell.

### Git

| Tool | What it does |
|---|---|
| `git_status` | Working tree and staged changes |
| `git_log` | Recent commit history |
| `git_show` | Inspect a specific commit |
| `git_diff_staged` | What's staged |
| `git_blame` | Line-by-line authorship |
| `git_add` | Stage files |
| `git_commit` | Commit with message |
| `git_push` | Push — always requires approval |

### Memory and knowledge

| Tool | What it does |
|---|---|
| `memory_status` | Show workspace memory state |
| `memory_facts` | Read stored memory facts |
| `memory_remember` | Save a new memory note |
| `memory_refresh` | Rebuild the memory summary |
| `knowledge_search` | Search the local workspace knowledge index |

### Agents and capabilities

| Tool | What it does |
|---|---|
| `list_agents` | List all available agents |
| `read_agent` | Read a specific agent's instructions |
| `list_toolbox_skills` | List skills in the toolbox |
| `read_toolbox_skill` | Read a skill's full content |
| `sync_toolbox` | Sync skills from remote |
| `list_engines` | List installed engines |
| `list_engine_tools` | List tools in a specific engine |
| `run_engine_tool` | Call a tool from an engine |
| `validate_engines` | Check engine configs for errors |
| `list_plugins` | List installed plugins |
| `read_plugin` | Read a plugin's manifest |
| `list_guides` | List quick-start guides and rules |
| `read_guide` | Read a specific guide |
| `spawn_agent` | Launch a sub-agent with its own turn context |
| `workspace_hop` | Switch the active workspace |
| `list_workspaces` | List known workspaces |

### Brief (document editor)

| Tool | What it does |
|---|---|
| `list_canvas_docs` | List Brief documents in the workspace |
| `create_canvas_doc` | Create a new Brief document |
| `edit_canvas` | Edit a Brief document (`replace_all`, `append`, `prepend`, `insert_after`) |

### Native environment

When enabled, the model can run code in a sandboxed environment that does not touch the real workspace until explicitly published.

| Tool | What it does |
|---|---|
| `native_env_status` | Check if the native environment is available |
| `native_exec` | Run code in the sandboxed environment |
| `native_editor` | Open a file in the sandboxed editor |
| `native_publish` | Copy verified changes from the sandbox to the real workspace |

### Web

| Tool | What it does |
|---|---|
| `web_fetch` | Fetch a public URL |
| `web_headers` | Read response headers |
| `web_links` | Extract links from a page |
| `web_tools` | Describe web tool availability |

### Usage

| Tool | What it does |
|---|---|
| `usage_cost_summary` | Estimated spend from local traces |
| `list_model_tools` | List all native tools with their approval policy |
| `describe_model_tool` | Full schema for one tool |
| `verify` | Ping the active model |

---

## What the model cannot do

- It cannot execute anything outside the tool bridge — there is no direct shell, no filesystem access, no network calls outside named tools.
- It cannot bypass the approval gate. `git push`, `rm`, `sudo`, and equivalent commands always surface for confirmation regardless of what the model requests.
- It cannot read files outside the active workspace without calling `workspace_hop` first.
- In offline mode (`local-mode set offline`), network tools (`web_fetch`, `web_links`, etc.) are disabled entirely — the model is told this upfront and cannot call them.
- It cannot fabricate context. The grounding rules explicitly prohibit inventing git state, file contents, or project metadata after a failed read.

---

## Offline mode

When `local-mode set offline` is active, the tool bridge drops all network-capable tools before the turn runs. The model sees a notice in the system prompt and the tools simply do not appear in the available tool list.

---

## Memory

Memory is not embedded in the system prompt by default. The model reads it on demand via `memory_facts` and `knowledge_search`. This keeps the prompt lean for short tasks — the model reaches for memory only when it's relevant, not on every turn.

The capability directory tells the model that memory is available (`memory: on-demand`) so it knows to reach for it when context is needed.

---

## Capability directory

Every turn, Switchbay builds a capability directory and embeds it in the system prompt. It lists:

- **Agents** — id, name, description, file path (if custom), and whether one is currently active
- **Skills** — id, name, description, file path
- **Engines** — id, name, description, available tools, working directory
- **Plugins** — id, name, enabled state, and assets each contributes (agents, skills, engines, MCP, knowledge)
- **MCP integrations** — label and config path (only in `switchbay-mcp` tool mode)

The model is instructed to disclose which capabilities it used on a single line at the end of its response: `Using: agent/<id> · skill/<id> · engine/<id>`. It must not claim a capability it did not actually inspect or apply.

---

## Context receipt

After each turn, Switchbay records which context blocks were present. This receipt is visible in the trace and the web UI:

```
user-context:2-files
workspace-profile:/path/to/.switchbay/workspace-profile.md
project-context:/path/to/SWITCHBAY.md
memory:on-demand(memory-helper-engine)
pins:loaded
active-plan:/path/to/.switchbay/plan.md
agent:security
native-env:sandbox
```

This makes it possible to see exactly what the model knew at the time of any turn.
