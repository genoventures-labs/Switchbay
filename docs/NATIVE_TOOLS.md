# Provider-Native Tools and the Switchbay Environment

Switchbay lets models use provider-familiar tool interfaces without giving providers direct authority over the host machine.

## Current support

| Provider | Interface | Execution |
|---|---|---|
| Anthropic | Native Bash and text-editor schemas | Switchbay isolated environment |
| OpenAI | Responses built-ins plus Switchbay functions | Provider servers or Switchbay isolated environment, according to tool type |
| Google Gemini | Native managed tools plus Switchbay functions | Provider servers or Switchbay isolated environment, according to tool type |
| OpenRouter / Hugging Face | Switchbay native-environment functions when explicitly selected | Switchbay isolated environment |

Anthropic server tools, OpenAI Responses built-ins, and Gemini managed tools retain their provider-owned events, citations, artifacts, continuation state, and mixed server/client tool history. Switchbay never misrepresents those observations as ordinary local function calls.

Provider-managed tools currently cover web search/fetch or URL context and provider-side code execution where the selected model supports them. Computer-use and automatically connected remote MCP servers remain off: both require a separate trust and approval surface.

## Switchbay Native Environment

Each session gets a disposable snapshot under:

```text
~/.switchbay/runtime/environments/<session-id>/workspace
```

The environment:

- excludes `.git`, `.switchbay`, dependencies/build output, `.env*`, credential files, private keys, and oversized files;
- receives a scrubbed process environment without provider keys or host secrets;
- denies network access;
- denies reads from the user's home directory except its own isolated root;
- allows writes only inside its isolated root;
- caps wall time and captured output;
- skips symlinks and rejects path traversal;
- never applies its edits to the real repository.

On macOS, strict execution uses `/usr/bin/sandbox-exec` and fails closed when Seatbelt is unavailable. Other platforms currently report the environment as unavailable rather than silently running with host authority.

## Controls

```text
/native
/native on
/native off
/native reset
```

`/native reset` removes the current session's disposable snapshot. It never changes the real workspace.

Environment override:

```bash
export SWITCHBAY_NATIVE_TOOLS=off
export SWITCHBAY_PROVIDER_TOOLS=off
```

## Choosing the execution lane

- Use `native_exec` or the provider-native Bash interface for untrusted snippets, calculations, generated scripts, and experiments.
- Use `native_editor` or the provider-native text editor to prototype changes without touching the repository.
- Use Switchbay's normal workspace tools when the user actually intends to change the real project.
- Provider-managed server tools stay inside the provider's infrastructure and never receive an automatic local filesystem mount.
