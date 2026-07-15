# Slash Commands Reference

Type `/` in the Switchbay TUI to search this catalog. Type `?` or `/help` for the compact capability guide.

## Help and Sessions

```text
/help                 Open the capability and keyboard guide
/sessions             List recent local sessions
/resume               Open the session picker
/save                 Persist the current session
/new                  Start a fresh session and model context
/purge 1w             Remove sessions older than an age
/compact              Compress older model context; keep the work feed visible
/clear                Clear only the visible work feed; retain model context
```

## Models, Lanes, and MCP

```text
/auto                 Clear model pins and restore trusted cloud auto-routing
/lane                 Cycle trusted cloud and the active local lane
/lane cloud           Trusted cloud auto-routing
/lane openai          Explicit OpenAI cloud provider
/lane anthropic       Explicit Anthropic cloud provider
/lane google          Explicit Google Gemini cloud provider
/lane gemini          Alias for the Google Gemini provider
/lane openrouter      Explicit OpenRouter lane
/lane huggingface     Explicit hosted Hugging Face lane
/lane cloud-mcp       Cloud lane with the Switchbay MCP bridge
/lane local           Active local provider
/lane ollama          Local Ollama
/lane ollama-cloud    Explicit Ollama Cloud lane
/lane mcp             Toggle the MCP bridge for the active model lane
/model                Open the model picker for the active lane
/model cloud-mcp      Pick a cloud model with MCP enabled
/models               Alias for the active-lane model picker
/mcp                  Show MCP bridge status and configuration
/mcp on               Enable the bridge for this session
/mcp off              Disable the bridge for this session
/mcp catalog          List trusted external MCP options
/create-mcp           Open the guided MCP configuration wizard
/native               Inspect provider-native and isolated tools
/native on            Enable native tool interfaces
/native off           Disable native tool interfaces
/native reset         Rebuild this session's disposable environment
```

## Workspace and Context

```text
/init                 Generate SWITCHBAY.md for this workspace
/init --update        Refresh SWITCHBAY.md from current project signals
/workspace            Show the active workspace
/workspace list       List known workspaces
/workspace add <path> Whitelist a workspace path
/workspace hop <name> Switch to a known workspace
/hop <name>           Short workspace-hop alias
/pin <path>           Inject a file into future model context
/pins                 List pinned files
/unpin <path>         Remove a pinned file
/edit                 Open the guided file-edit picker
/profile              Show the structured workspace profile
/profile refresh      Rebuild the workspace profile
/context              Show private machine-local context
/context path         Print its local directory
/context read <file>  Read one context file
/quickstarts          List model-readable quick guides
/rules                List operating rules
/rules create         Open the guided rule creator
/create-rule          Alias for the rule creator
```

## Memory, Knowledge, and Daily Work

```text
/remember <note>      Save a workspace memory note
/memories             List memory notes
/memory               Show operational-memory status
/memory refresh       Rebuild operational memory
/memory facts         Show structured workspace facts
/forget <index>       Remove a memory note
/index                Show Workspace Knowledge status
/index refresh        Rebuild the sourced knowledge index
/search <query>       Search sourced workspace snippets
/agenda               Show today's Daily Board
/task add <text>      Add a Daily Board task
/task done <id>       Complete a Daily Board task
/task clear           Clear today's Daily Board
/workflows            List saved workspace workflows
/workflow <id>        Inspect a workflow
/workflow save ...    Save: /workflow save <name> :: <instructions>
/workflow run <id>    Run a saved workflow
```

## Planning, Review, and Receipts

```text
/plan <goal>          Generate a visible step-by-step plan
/stop                 Stop the active plan in any plan state
/review [focus]       Review the current git diff
/undo                 Restore the last changed file to HEAD
/undo-turn            Restore every changed file to HEAD
/checkpoint [name]    Save a named git-stash checkpoint
/checkpoints          List Switchbay checkpoints
/restore <index>      Apply a checkpoint
/trace                Show the latest durable turn receipt
/trace export         Print the latest trace JSON path
/usage                Graph turns, routes, tokens, tools, and estimated spend
/graph trace          Render the latest turn as a flow graph
/radar                Run read-only local friction checks
/handoff              Build a compact next-session handoff
```

## Agents, Skills, Engines, and Plugins

```text
/agents               Open the specialist-agent picker
/agent <id>           Activate or toggle an agent
/agent off            Return to the default model persona
/create-agent         Open the guided agent creator
/skills               Open the skills picker
/skills sync          Sync GitHub-backed skills
/skills list          Print available skills
/skills read <id>     Read one skill
/create-skill         Open the guided skill creator
/toolbox              Compatibility alias for skills/toolbox commands
/engines              Open the registered-engine picker
/engines list         Print registered engines
/engine-bay           Show the GitHub engine/template hub
/engine-bay sync      Sync the engine hub
/engine-bay templates List cached engine templates
/creative             Show Creative Engine tools
/web                  Show guarded Web Engine tools
/create-engine        Open the guided engine creator
/plugins              Show installed workspace plugins
/plugins list         Print installed plugins
/plugins inspect <id> Inspect a plugin and its assets
/create-plugin        Open the guided plugin creator
```

## Interface

```text
/collapse             Hide or show right-side telemetry panels
```

Useful aliases include `/today` and `/tasks` for `/agenda`, `/workspaces` for `/workspace`, and `/quickstart` for `/quickstarts`.
