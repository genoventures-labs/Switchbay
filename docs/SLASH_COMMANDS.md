# Slash Commands Reference

Full list of TUI slash commands. Type any of these inside Switchbay's terminal UI.

## Sessions

```text
/sessions          List recent local sessions
/resume            Open the session picker
/save              Persist the current session
/new               Start a fresh session
/compact           Compress the transcript into context
/clear             Clear the visible conversation
```

## Model and Lane

```text
/lane              Cycle Cloud and the active local provider
/lane openai       Use OpenAI for the cloud lane
/lane anthropic    Use Anthropic for the cloud lane
/lane google       Use Google Gemini for the cloud lane
/lane ollama       Use Ollama as the local provider
/model             Pick a model from the active lane
/mcp               Show or initialize Switchbay MCP bridge config
/mcp on            Enable the Switchbay MCP bridge for this session
/mcp off           Disable the Switchbay MCP bridge for this session
/mcp catalog       List trusted MCP config options
/create-mcp        Create a custom Switchbay MCP bridge config
```

## Workspace

```text
/init              Generate SWITCHBAY.md for this repo
/workspace         Show the active workspace snapshot
/workspace list    List known workspaces
/workspace add     Whitelist a workspace path
/workspace hop     Switch to a known workspace
/hop               Alias for workspace switching
/pin               Pin a file into future turn context
/pins              List pinned files
/edit              Open the file edit picker
```

## Memory

```text
/remember          Save a workspace memory note
/memories          List workspace memory notes
/memory            Show or refresh operational memory
/memory refresh    Rebuild the operational memory summary
/memory facts      Show structured workspace facts
```

## Workspace Knowledge

```text
/index             Show or refresh Workspace Knowledge
/index refresh     Rebuild the knowledge index
/search            Search sourced Workspace Knowledge snippets
```

## Daily Board

```text
/agenda            Show today's Daily Board
/task add          Add a task to today's Daily Board
/task done         Mark a Daily Board task done
/task clear        Clear today's Daily Board
```

## Context and Rules

```text
/quickstarts       List quick-start guides Switchbay reads before matching tool work
/rules             List built-in, user, and workspace operating rules
/create-rule       Create a conversational rule for Switchbay and agents
```

## Checkpoints and Review

```text
/review            Review the current diff
/checkpoint        Save a git-stash checkpoint
/checkpoints       List checkpoints
/restore           Restore a checkpoint
/trace             Show the latest durable turn receipt
/trace export      Export the latest trace to a file
```

## Planning

```text
/plan              Generate and execute a plan step by step
```

## Agents

```text
/agent <id>        Activate a specialist agent
/agents            Browse available agents
/create-agent      Create a custom local agent
```

## Skills

```text
/skills            Show or sync reusable agent skills
/skills sync       Pull latest skills from GitHub
/skills list       List all available skills
/skills read <id>  Read a skill's full content
/create-skill      Create a custom skill
```

## Engines

```text
/engines           List registered engines
/create-engine     Create a custom workspace engine manifest
/engine-bay        Show or sync the GitHub engine hub
/engine-bay sync   Pull latest engine templates from GitHub
/web               Show Web Engine status and tools
/creative          Show the built-in Creative Engine lane
```

## Plugins

```text
/plugins           Show installed workspace plugins
/plugins list      List all plugins
/plugins inspect   Inspect a specific plugin
/create-plugin     Create a local plugin manifest
```

## UI

```text
/collapse          Hide or show the right-side telemetry panels
```
