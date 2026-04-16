export type SlashCommand = {
  category: "workspace" | "files" | "edits" | "git" | "verify" | "ori";
  command: string;
  description: string;
  example: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    category: "workspace",
    command: "/resume",
    description: "Pick a previous session to resume.",
    example: "/resume",
  },
  {
    category: "workspace",
    command: "/clear",
    description: "Clear the current conversation and session view.",
    example: "/clear",
  },
  {
    category: "workspace",
    command: "/hop",
    description: "Travel to a whitelisted workspace directory.",
    example: "/hop vuln.ai",
  },
  {
    category: "workspace",
    command: "/locations",
    description: "List all whitelisted and auto-discovered travel locations.",
    example: "/locations",
  },
  {
    category: "workspace",
    command: "/workspace",
    description: "Refresh and show repo, branch, and dirty-file context.",
    example: "/workspace",
  },
  {
    category: "workspace",
    command: "/files",
    description: "List recent project files from the current workspace.",
    example: "/files",
  },
  {
    category: "workspace",
    command: "/diff",
    description: "Show the current git diff stat for local changes.",
    example: "/diff",
  },
  {
    category: "workspace",
    command: "/health",
    description: "Check ORI runtime health.",
    example: "/health",
  },
  {
    category: "workspace",
    command: "/models",
    description: "List models available to the current runtime key.",
    example: "/models",
  },
  {
    category: "workspace",
    command: "/tools",
    description: "List ORI runtime tools exposed by the current key/context.",
    example: "/tools",
  },
  {
    category: "workspace",
    command: "/browser-health",
    description: "Check the sovereign browser runtime health.",
    example: "/browser-health",
  },
  {
    category: "workspace",
    command: "/daemons",
    description: "Show active ORI daemon health.",
    example: "/daemons",
  },
  {
    category: "workspace",
    command: "/spaces",
    description: "List knowledge spaces for the current tenant.",
    example: "/spaces",
  },
  {
    category: "workspace",
    command: "/sessions",
    description: "List recent ORI runtime sessions for the current surface.",
    example: "/sessions",
  },
  {
    category: "workspace",
    command: "/session",
    description: "Show recent messages for a specific ORI session id.",
    example: "/session session_123",
  },
  {
    category: "verify",
    command: "/verify",
    description: "Run bun test and capture verification output.",
    example: "/verify",
  },
  {
    category: "files",
    command: "/read",
    description: "Read a file into the transcript.",
    example: "/read src/tui/app.tsx",
  },
  {
    category: "edits",
    command: "/edit",
    description: "Ask ORI to propose an edit for a file and stage it as a draft.",
    example: "/edit src/tui/app.tsx ::: Split the websocket setup into a helper",
  },
  {
    category: "edits",
    command: "/write",
    description: "Write file contents directly using the command separator.",
    example: "/write notes.txt ::: hello from ORI",
  },
  {
    category: "edits",
    command: "/append",
    description: "Append content to an existing file.",
    example: "/append notes.txt ::: another line",
  },
  {
    category: "edits",
    command: "/replace",
    description: "Replace the first matching text in a file.",
    example: "/replace README.md ::: ORI Studio ::: ORI Code",
  },
  {
    category: "edits",
    command: "/apply",
    description: "Apply the currently staged draft patch.",
    example: "/apply",
  },
  {
    category: "edits",
    command: "/cancel",
    description: "Cancel the currently staged draft patch.",
    example: "/cancel",
  },
  {
    category: "git",
    command: "/git-status",
    description: "Show branch and working tree status.",
    example: "/git-status",
  },
  {
    category: "git",
    command: "/git-log",
    description: "Show the five most recent commits.",
    example: "/git-log",
  },
  {
    category: "ori",
    command: "/ask",
    description: "Use ORI's ask helper for a direct question.",
    example: "/ask what should I tackle next in this repo?",
  },
  {
    category: "ori",
    command: "/memory",
    description: "Ask ORI to recall continuity or prior context.",
    example: "/memory what constraints matter for this session?",
  },
  {
    category: "ori",
    command: "/plan",
    description: "Draft an execution plan, review it, then approve to start building.",
    example: "/plan add a planning approval workflow for multi-file changes",
  },
  {
    category: "ori",
    command: "/plan-review",
    description: "Ask ORI to critique a plan before acting.",
    example: "/plan-review inspect auth flow, patch retry logic, then verify",
  },
  {
    category: "ori",
    command: "/repo-research",
    description: "Ask ORI to research the repo using current context.",
    example: "/repo-research summarize how the TUI and agent loop fit together",
  },
  {
    category: "ori",
    command: "/search",
    description: "Use ORI's web-search capability.",
    example: "/search Bun Ink raw mode keyboard handling",
  },
  {
    category: "ori",
    command: "/fetch",
    description: "Fetch and summarize a URL through ORI.",
    example: "/fetch https://dev.thynaptic.com/llms.txt",
  },
  {
    category: "ori",
    command: "/research",
    description: "Run ORI's deeper research capability.",
    example: "/research compare terminal agent approval UX patterns",
  },
  {
    category: "ori",
    command: "/repo-report",
    description: "Generate a compact report for the current repo.",
    example: "/repo-report give me a high-signal repo snapshot",
  },
];

export function getCommandMatches(query: string): SlashCommand[] {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed.startsWith("/")) {
    return [];
  }

  return SLASH_COMMANDS.filter((item) => item.command.startsWith(trimmed)).slice(0, 6);
}
