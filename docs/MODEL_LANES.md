# Model Lanes

Switchbay routes between cloud and local model providers without changing your workflow. Lanes are set via environment variables, stored config, or toggled live inside the TUI.

## Cloud Lane

```bash
export SWITCHBAY_LANE=cloud
export SWITCHBAY_CLOUD_PROVIDER=auto  # auto | openai | anthropic | google
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...
```

Anthropic tool calls use an 8,192-token output allowance by default. Switchbay detects incomplete streamed tool JSON and rejects it before any filesystem or shell execution, then asks the model to retry with a smaller complete operation. Override the allowance when needed:

```bash
export SWITCHBAY_ANTHROPIC_MAX_TOKENS=16384
```

The macOS and Linux service installers preserve this override in the service environment.

Provider-native client interfaces and Switchbay's isolated execution environment are enabled by default. Claude receives its trained Bash and text-editor schemas; other providers receive equivalent Switchbay functions. Inspect or toggle them with `/native`, `/native on`, and `/native off`. See [NATIVE_TOOLS.md](NATIVE_TOOLS.md).

Switchbay stores cloud provider defaults in `~/.switchbay/cloud-providers.json`. Use it to keep provider routing, API bases, key env names, and default models portable without rewriting shell startup files:

```bash
switchbay cloud-provider
switchbay cloud-provider set auto
switchbay cloud-provider set openai
switchbay cloud-provider set anthropic
switchbay cloud-provider set google
```

Custom cloud model IDs live in `~/.switchbay/cloud-models.json` and feed the same model drawer/list as built-in presets. Use this when a cloud provider ships a model before Switchbay has baked it in:

```bash
switchbay model add openai gpt-new-model --label "GPT New Model"
switchbay --lane cloud --add-model gpt-new-model
switchbay models --lane cloud
```

## Local Lane — Ollama

```bash
export SWITCHBAY_LANE=local
export SWITCHBAY_LOCAL_PROVIDER=ollama
export SWITCHBAY_OLLAMA_BASE=http://localhost:11434/api
export SWITCHBAY_OLLAMA_MODEL=llama3.2
```

Pull models directly from Switchbay:

```bash
switchbay model pull ibm/granite-4-micro
switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M
```

## Switchbay MCP Bridge

Enable Switchbay's own local MCP-style tool bridge over any lane:

```bash
export SWITCHBAY_TOOL_MODE=switchbay-mcp
# or:
export SWITCHBAY_MCP=on
```

Cloud + MCP alias:

```bash
export SWITCHBAY_LANE=cloud-mcp
```

Inside the TUI: `/mcp on` and `/mcp off` toggle the bridge for the session. `/mcp init` generates an empty starter config, `/mcp catalog` lists trusted options, and `/create-mcp` opens the conversational config builder.

Switchbay only creates MCP configs from Switchbay's trusted catalog: Playwright, filesystem, GitHub, memory, fetch, sequential-thinking, and Postgres. Anything outside the catalog gets refused with instructions to proceed manually.

## Auto Routing

Model names also act as conversational pins. A turn beginning with `Claude`, `GPT`, `Gemini`, `OpenRouter`, `Hugging Face`, `Ollama`, or `Ollama Cloud` selects that model lane and keeps it active for later unaddressed turns. Calling another model replaces the pin. `Auto, ...` and `/auto` clear it and restore trusted cloud routing.

When using `auto` cloud routing, Switchbay picks a provider based on intent:

- **Structured/summary tasks** → OpenAI
- **Image/screenshot prompts** → OpenAI vision
- **Code/tool-heavy work** → Anthropic
- **Explicit lane or provider** → honors it directly

Completed turns show the routing decision:

```text
Using: cloud/anthropic/claude-sonnet-4-5 · intent=code_work · mode=auto
```

OpenAI image input works through direct image URLs, base64 data URLs, or local image file paths (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) mentioned in the prompt. If another cloud provider is pinned when an image is referenced, Switchbay tells you to switch rather than silently ignoring the image.

## Per-Command Lane Override

```bash
switchbay --lane cloud "review the auth flow"
switchbay --lane local "summarize the changed files"
SWITCHBAY_MCP=on switchbay --lane cloud "use the configured MCP-style workflow"
switchbay --lane openai "Inspect ./screen.png and summarize the UI issue"
```

## TUI Lane Controls

```text
/lane              Cycle Cloud and the active local provider
/lane openai       Pin OpenAI for the cloud lane
/lane anthropic    Pin Anthropic for the cloud lane
/lane google       Pin Google Gemini for the cloud lane
/lane ollama       Use Ollama as the local provider
/model             Pick a model from the active lane
/mcp on            Enable the Switchbay MCP bridge
/mcp off           Disable the Switchbay MCP bridge
/mcp catalog       List trusted MCP config options
/mcp init          Generate an empty starter MCP config
/create-mcp        Conversational MCP config builder
```
