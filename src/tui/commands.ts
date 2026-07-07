export type SlashCommand = {
  category: "session" | "context" | "safety" | "planning" | "agents" | "engines" | "skills" | "toolbox" | "runtime";
  command: string;
  description: string;
  example: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
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
    description: "Summarize this session into compressed context and clear the transcript.",
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
    description: "Toggle runtime lane between Cloud and LM Studio.",
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
    command: "/lane local",
    description: "Switch this TUI session to the local LM Studio lane.",
    example: "/lane local",
  },
  {
    category: "runtime",
    command: "/model",
    description: "Open the model picker for the active runtime lane.",
    example: "/model",
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
    command: "/create-engine",
    description: "Open the guided custom-engine manifest wizard.",
    example: "/create-engine",
  },
  {
    category: "toolbox",
    command: "/toolbox",
    description: "Show or sync agent skills and reusable working methods.",
    example: "/toolbox list",
  },
  {
    category: "skills",
    command: "/skills",
    description: "Open the Toolbox skills drawer.",
    example: "/skills",
  },
  {
    category: "skills",
    command: "/skills sync",
    description: "Sync the GitHub-backed Toolbox skills repo.",
    example: "/skills sync",
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
];

export function getCommandMatches(query: string): SlashCommand[] {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed.startsWith("/")) {
    return [];
  }

  const search = trimmed.slice(1);
  return SLASH_COMMANDS.filter((item) => {
    const haystack = [
      item.command.slice(1),
      item.description,
      item.example,
      item.category,
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  }).slice(0, 8);
}
