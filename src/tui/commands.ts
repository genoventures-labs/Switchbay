export type SlashCommand = {
  category: "session" | "context" | "safety" | "planning" | "agents" | "engines" | "skills" | "toolbox" | "plugins" | "runtime";
  command: string;
  description: string;
  example: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    category: "session",
    command: "/help",
    description: "Open the Switchbay capability and keyboard guide.",
    example: "/help",
  },
  {
    category: "runtime",
    command: "/auto",
    description: "Clear the pinned cloud model and restore trusted auto-routing.",
    example: "/auto",
  },
  {
    category: "session",
    command: "/sessions",
    description: "List recent local session history.",
    example: "/sessions",
  },
  {
    category: "session",
    command: "/resume",
    description: "Open the local session picker.",
    example: "/resume",
  },
  {
    category: "session",
    command: "/save",
    description: "Persist the current session state.",
    example: "/save",
  },
  {
    category: "session",
    command: "/new",
    description: "Start a fresh local session.",
    example: "/new",
  },
  {
    category: "session",
    command: "/purge",
    description: "Clean up old local sessions by age.",
    example: "/purge 1w",
  },
  {
    category: "session",
    command: "/compact",
    description: "Compress older model context while keeping the visible work feed.",
    example: "/compact",
  },
  {
    category: "session",
    command: "/clear",
    description: "Clear the current conversation and session view.",
    example: "/clear",
  },
  {
    category: "runtime",
    command: "/lane",
    description: "Cycle model lane between Cloud and the active local provider.",
    example: "/lane",
  },
  {
    category: "runtime",
    command: "/lane cloud",
    description: "Switch this TUI session to the cloud model lane.",
    example: "/lane cloud",
  },
  {
    category: "runtime",
    command: "/lane openai",
    description: "Switch this TUI session to the OpenAI cloud provider.",
    example: "/lane openai",
  },
  {
    category: "runtime",
    command: "/lane anthropic",
    description: "Switch this TUI session to the Anthropic cloud provider.",
    example: "/lane anthropic",
  },
  {
    category: "runtime",
    command: "/lane google",
    description: "Switch this TUI session to the Google Gemini cloud provider.",
    example: "/lane google",
  },
  {
    category: "runtime",
    command: "/lane gemini",
    description: "Switch this TUI session to the Gemini cloud provider.",
    example: "/lane gemini",
  },
  {
    category: "runtime",
    command: "/lane openrouter",
    description: "Switch this session to an explicitly selected OpenRouter model.",
    example: "/lane openrouter",
  },
  {
    category: "runtime",
    command: "/lane huggingface",
    description: "Switch this session to an explicitly selected hosted Hugging Face model.",
    example: "/lane huggingface",
  },
  {
    category: "runtime",
    command: "/lane cloud-mcp",
    description: "Use cloud models with Switchbay MCP bridge enabled.",
    example: "/lane cloud-mcp",
  },
  {
    category: "runtime",
    command: "/lane local",
    description: "Switch this TUI session to the active local provider lane.",
    example: "/lane local",
  },
  {
    category: "runtime",
    command: "/lane ollama",
    description: "Switch this TUI session to the local Ollama provider.",
    example: "/lane ollama",
  },
  {
    category: "runtime",
    command: "/lane ollama-cloud",
    description: "Switch this session to Ollama's hosted cloud API.",
    example: "/lane ollama-cloud",
  },
  {
    category: "runtime",
    command: "/lane mcp",
    description: "Enable Switchbay MCP bridge for the active model lane.",
    example: "/lane mcp",
  },
  {
    category: "runtime",
    command: "/model",
    description: "Open the model picker for the active runtime lane.",
    example: "/model",
  },
  {
    category: "runtime",
    command: "/model cloud-mcp",
    description: "Pick a cloud model and keep Switchbay MCP bridge enabled.",
    example: "/model cloud-mcp",
  },
  {
    category: "runtime",
    command: "/model remove",
    description: "Remove a custom model from the cloud lane catalog.",
    example: "/model remove gpt-5.5",
  },
  {
    category: "runtime",
    command: "/model verify",
    description: "Re-verify a custom cloud model (or all catalog models) against the provider API.",
    example: "/model verify gpt-5.5",
  },
  {
    category: "runtime",
    command: "/models clear",
    description: "Remove all custom models from the cloud catalog, keeping built-in presets.",
    example: "/models clear",
  },
  {
    category: "runtime",
    command: "/models",
    description: "List/select models for the active runtime lane.",
    example: "/models",
  },
  {
    category: "runtime",
    command: "/collapse",
    description: "Hide or show the read-only right-side telemetry panels.",
    example: "/collapse",
  },
  {
    category: "runtime",
    command: "/mcp",
    description: "Show MCP bridge config or use /mcp on and /mcp off.",
    example: "/mcp init",
  },
  {
    category: "runtime",
    command: "/mcp catalog",
    description: "List trusted MCP servers models can configure without guessing.",
    example: "/mcp catalog",
  },
  {
    category: "runtime",
    command: "/mcp on",
    description: "Enable Switchbay MCP bridge on the active cloud/local model lane.",
    example: "/mcp on",
  },
  {
    category: "runtime",
    command: "/mcp off",
    description: "Disable Switchbay MCP bridge for this session.",
    example: "/mcp off",
  },
  {
    category: "runtime",
    command: "/create-mcp",
    description: "Open the guided external MCP config wizard.",
    example: "/create-mcp",
  },
  {
    category: "context",
    command: "/init",
    description: "Generate a project context file for this workspace.",
    example: "/init",
  },
  {
    category: "context",
    command: "/init --update",
    description: "Regenerate the project context file with current signals.",
    example: "/init --update",
  },
  {
    category: "context",
    command: "/workspace",
    description: "Show the active workspace snapshot and workspace commands.",
    example: "/workspace",
  },
  {
    category: "context",
    command: "/workspace list",
    description: "List known whitelisted or discovered workspaces.",
    example: "/workspace list",
  },
  {
    category: "context",
    command: "/workspace add",
    description: "Whitelist a workspace path for hopping.",
    example: "/workspace add ~/Projects/my-app",
  },
  {
    category: "context",
    command: "/workspace hop",
    description: "Switch to a known workspace by fuzzy name or path.",
    example: "/workspace hop my-app",
  },
  {
    category: "context",
    command: "/hop",
    description: "Alias for switching to a known workspace.",
    example: "/hop my-app",
  },
  {
    category: "context",
    command: "/pin",
    description: "Pin a file so it is injected into future turn context.",
    example: "/pin src/agent/loop.ts",
  },
  {
    category: "context",
    command: "/pins",
    description: "List pinned files for this workspace.",
    example: "/pins",
  },
  {
    category: "context",
    command: "/unpin",
    description: "Remove a pinned file from future turn context.",
    example: "/unpin src/agent/loop.ts",
  },
  {
    category: "context",
    command: "/remember",
    description: "Save a workspace memory note.",
    example: '/remember "use Bun scripts in this repo"',
  },
  {
    category: "context",
    command: "/memories",
    description: "List workspace memory notes.",
    example: "/memories",
  },
  {
    category: "context",
    command: "/memory",
    description: "Show or refresh operational workspace memory.",
    example: "/memory refresh",
  },
  {
    category: "context",
    command: "/profile",
    description: "Show or refresh the structured workspace profile.",
    example: "/profile refresh",
  },
  {
    category: "context",
    command: "/context",
    description: "Show the private machine-local context loaded for every model turn.",
    example: "/context read working-style",
  },
  {
    category: "runtime",
    command: "/native",
    description: "Inspect or toggle provider-native interfaces and the isolated Switchbay execution environment.",
    example: "/native on",
  },
  {
    category: "planning",
    command: "/workflows",
    description: "List reusable workspace workflows.",
    example: "/workflows",
  },
  {
    category: "planning",
    command: "/workflow",
    description: "Save, inspect, or run an explicit reusable workflow.",
    example: "/workflow save weekly-report :: Pull sales data, verify dates, and summarize results",
  },
  {
    category: "context",
    command: "/agenda",
    description: "Show today's Daily Board.",
    example: "/agenda",
  },
  {
    category: "context",
    command: "/task add",
    description: "Add a task to today's Daily Board.",
    example: "/task add test brew install",
  },
  {
    category: "context",
    command: "/task done",
    description: "Mark a Daily Board task done.",
    example: "/task done 1",
  },
  {
    category: "context",
    command: "/task clear",
    description: "Clear today's Daily Board.",
    example: "/task clear",
  },
  {
    category: "context",
    command: "/index",
    description: "Show or refresh the local Workspace Knowledge map.",
    example: "/index refresh",
  },
  {
    category: "context",
    command: "/search",
    description: "Search sourced snippets from Workspace Knowledge.",
    example: "/search approval gates",
  },
  {
    category: "context",
    command: "/trace",
    description: "Show the latest durable turn receipt.",
    example: "/trace last",
  },
  {
    category: "context",
    command: "/trace export",
    description: "Show the latest trace JSON file path.",
    example: "/trace export",
  },
  {
    category: "runtime",
    command: "/usage",
    description: "Graph traced turns, routes, tokens, tools, and estimated API spend.",
    example: "/usage",
  },
  {
    category: "runtime",
    command: "/graph trace",
    description: "Render the latest agent turn as a terminal flow graph.",
    example: "/graph trace",
  },
  {
    category: "context",
    command: "/radar",
    description: "Run read-only local friction checks.",
    example: "/radar",
  },
  {
    category: "context",
    command: "/handoff",
    description: "Write a compact handoff for the next session.",
    example: "/handoff",
  },
  {
    category: "context",
    command: "/quickstarts",
    description: "List quick-start guides models read before matching tool/lane work.",
    example: "/quickstarts",
  },
  {
    category: "context",
    command: "/rules",
    description: "List user, workspace, and built-in operating rules.",
    example: "/rules",
  },
  {
    category: "context",
    command: "/create-rule",
    description: "Create a conversational operating rule for models and agents.",
    example: "/create-rule",
  },
  {
    category: "context",
    command: "/forget",
    description: "Remove a memory note by index.",
    example: "/forget 0",
  },
  {
    category: "safety",
    command: "/review",
    description: "Review the current diff.",
    example: "/review security",
  },
  {
    category: "safety",
    command: "/undo",
    description: "Restore the last changed file to HEAD.",
    example: "/undo",
  },
  {
    category: "safety",
    command: "/undo-turn",
    description: "Restore every file changed vs HEAD.",
    example: "/undo-turn",
  },
  {
    category: "safety",
    command: "/checkpoint",
    description: "Save a named git-stash checkpoint.",
    example: "/checkpoint before-refactor",
  },
  {
    category: "safety",
    command: "/checkpoints",
    description: "List checkpoints in this repo.",
    example: "/checkpoints",
  },
  {
    category: "safety",
    command: "/restore",
    description: "Restore a checkpoint by index.",
    example: "/restore 0",
  },
  {
    category: "planning",
    command: "/plan",
    description: "Generate a multi-step plan and execute it step by step.",
    example: '/plan "split local command handlers"',
  },
  {
    category: "planning",
    command: "/stop",
    description: "Stop the active plan.",
    example: "/stop",
  },
  {
    category: "engines",
    command: "/engines",
    description: "Open the registered engine drawer.",
    example: "/engines",
  },
  {
    category: "engines",
    command: "/engines list",
    description: "Print registered Switchbay engines as text.",
    example: "/engines list",
  },
  {
    category: "engines",
    command: "/engine-bay",
    description: "Show or sync the GitHub-backed Switchbay engine/template hub.",
    example: "/engine-bay sync",
  },
  {
    category: "engines",
    command: "/creative",
    description: "Show Creative Engine tools for writing packets, hooks, names, and drafts.",
    example: "/creative",
  },
  {
    category: "engines",
    command: "/web",
    description: "Show guarded Web Engine tools for explicit public URL reads.",
    example: "/web",
  },
  {
    category: "engines",
    command: "/create-engine",
    description: "Open the guided custom-engine manifest wizard.",
    example: "/create-engine",
  },
  {
    category: "toolbox",
    command: "/toolbox",
    description: "Compatibility alias for the underlying skills/toolbox cache.",
    example: "/toolbox list",
  },
  {
    category: "skills",
    command: "/skills",
    description: "Open the model skills drawer.",
    example: "/skills",
  },
  {
    category: "skills",
    command: "/sync",
    description: "Sync both engines and skills libraries in one shot.",
    example: "/sync",
  },
  {
    category: "skills",
    command: "/skills sync",
    description: "Sync the GitHub-backed skills repo.",
    example: "/skills sync",
  },
  {
    category: "skills",
    command: "/create-skill",
    description: "Open the guided skill markdown wizard.",
    example: "/create-skill",
  },
  {
    category: "plugins",
    command: "/plugins",
    description: "Show installed workspace plugins that bundle agents, skills, engines, knowledge, or MCP configs.",
    example: "/plugins",
  },
  {
    category: "plugins",
    command: "/plugins inspect",
    description: "Inspect a workspace plugin manifest.",
    example: "/plugins inspect gumroad-ops",
  },
  {
    category: "plugins",
    command: "/create-plugin",
    description: "Open the guided Switchbay plugin manifest wizard.",
    example: "/create-plugin",
  },
  {
    category: "agents",
    command: "/agents",
    description: "Open the agent picker to browse and toggle specialist agents.",
    example: "/agents",
  },
  {
    category: "agents",
    command: "/agent",
    description: "Activate an agent by ID, or open the picker with no ID.",
    example: "/agent backend",
  },
  {
    category: "agents",
    command: "/agent off",
    description: "Deactivate the current agent.",
    example: "/agent off",
  },
  {
    category: "agents",
    command: "/create-agent",
    description: "Open the guided custom-agent wizard.",
    example: "/create-agent",
  },
  {
    category: "context",
    command: "/edit",
    description: "Open the file picker and describe an edit intent.",
    example: "/edit",
  },
  { category: "context", command: "/memory refresh", description: "Rebuild operational workspace memory.", example: "/memory refresh" },
  { category: "context", command: "/memory facts", description: "Show structured workspace facts.", example: "/memory facts" },
  { category: "context", command: "/profile refresh", description: "Rebuild the structured workspace profile.", example: "/profile refresh" },
  { category: "context", command: "/context path", description: "Print the private machine-local context directory.", example: "/context path" },
  { category: "context", command: "/context read", description: "Read one private context file.", example: "/context read working-style" },
  { category: "runtime", command: "/native on", description: "Enable provider-native and isolated tools.", example: "/native on" },
  { category: "runtime", command: "/native off", description: "Disable provider-native and isolated tools.", example: "/native off" },
  { category: "runtime", command: "/native reset", description: "Rebuild this session's disposable environment.", example: "/native reset" },
  { category: "planning", command: "/workflow save", description: "Save a reusable named workflow.", example: "/workflow save release :: Test, build, and summarize" },
  { category: "planning", command: "/workflow run", description: "Run a saved workflow by ID.", example: "/workflow run release" },
  { category: "context", command: "/index refresh", description: "Rebuild the sourced Workspace Knowledge index.", example: "/index refresh" },
  { category: "context", command: "/rules create", description: "Open the guided operating-rule creator.", example: "/rules create" },
  { category: "engines", command: "/engine-bay sync", description: "Sync engine templates from GitHub.", example: "/engine-bay sync" },
  { category: "engines", command: "/engine-bay templates", description: "List cached engine templates.", example: "/engine-bay templates" },
  { category: "skills", command: "/skills list", description: "Print all available skills as text.", example: "/skills list" },
  { category: "skills", command: "/skills read", description: "Read a skill's full instructions.", example: "/skills read code-review-pass" },
  { category: "plugins", command: "/plugins list", description: "Print installed workspace plugins as text.", example: "/plugins list" },
];

export function getCommandMatches(query: string): SlashCommand[] {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed.startsWith("/")) {
    return [];
  }

  const search = trimmed.slice(1);
  return SLASH_COMMANDS.map((item, index) => {
    const haystack = [
      item.command.slice(1),
      item.description,
      item.example,
      item.category,
    ].join(" ").toLowerCase();
    const command = item.command.slice(1).toLowerCase();
    const score = command === search
      ? 0
      : command.startsWith(search)
        ? 1
        : command.includes(search)
          ? 2
          : haystack.includes(search)
            ? 3
            : 99;
    return { item, index, score };
  }).filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score || a.item.command.length - b.item.command.length || a.index - b.index)
    .slice(0, 8)
    .map(({ item }) => item);
}
