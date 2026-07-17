import { cliHeader, cliColorEnabled } from "./presentation";

type Entry = [command: string, description: string];

const GROUPS: Array<[string, Entry[]]> = [
  ["WORKSPACE", [
    ["switchbay", "Open the terminal workspace"],
    ["switchbay open", "Open the visual workspace"],
    ['switchbay "<request>"', "Run a one-shot request"],
    ["switchbay --resume [id]", "Resume a saved session"],
    ["switchbay agenda", "Open today's Daily Board"],
    ["switchbay task <add|done|clear>", "Manage today's work"],
    ["switchbay memory <list|facts|add|refresh>", "Operate workspace memory"],
    ["switchbay knowledge <search|refresh>", "Query the knowledge index"],
  ]],
  ["RUNTIME", [
    ["switchbay models [--lane <lane>]", "Browse the model runtime"],
    ["switchbay model [lane] [model|auto]", "Inspect or pin routing"],
    ["switchbay model pull <model> [-y]", "Install a local model (--yes skips HF caution)"],
    ["switchbay model add <id> [-y]", "Add cloud model (--yes skips unverified warning)"],
    ["switchbay cloud-provider [set <id>]", "Configure trusted cloud routing"],
    ["switchbay local-provider [set <id>]", "Configure the local runtime"],
    ["switchbay mcp <status|init|catalog>", "Manage external tool bridges"],
  ]],
  ["LIBRARY", [
    ["switchbay agents <list|read|create>", "Specialist workers"],
    ["switchbay engines <list|templates|sync>", "Engine Bay tools"],
    ["switchbay skills <list|read|templates|sync>", "Skill Library guides"],
    ["switchbay plugins <list|inspect>", "Installed capability packs"],
  ]],
  ["ACTIVITY", [
    ["switchbay trace [export]", "Inspect the latest turn ledger"],
    ["switchbay graph trace", "View the latest execution flow"],
    ["switchbay usage", "See turns, tokens, tools, and spend"],
    ["switchbay radar", "Run the Friction Radar"],
    ["switchbay handoff", "Prepare the next session"],
  ]],
  ["SYSTEM", [
    ["switchbay serve [--detach]", "Start the local API"],
    ["switchbay service <status|install|restart|uninstall>", "Manage startup service"],
    ["switchbay update", "Update, rebuild, and refresh"],
    ["switchbay version", "Show installed version"],
  ]],
];

export function renderCliHelp(color = cliColorEnabled()): string {
  const lines = [
    cliHeader("Switchbay · Command Center", "Local AI Work System", color),
    "",
    "  Open a workspace, route models, operate tools, and inspect every run.",
  ];
  for (const [name, entries] of GROUPS) {
    lines.push("", `  ${name}`);
    for (const [command, description] of entries) lines.push(`  ${command.padEnd(47)}  ${description}`);
  }
  lines.push(
    "", "  OPTIONS",
    "  --lane <lane>                                  cloud | local | openai | anthropic | gemini | cloud-mcp | ollama-cloud | openrouter | huggingface",
    "  --hop <workspace>                              Open another known workspace",
    "  --vision <path|url>                            Attach an image for this turn",
    "  --new                                          Start a clean session",
    "  --purge <1d|1w|...>                            Remove older saved sessions",
    "  -s, --surface <type>  -p, --profile <name>     Set working context",
    "  -m, --mode <build|design|debug>                Set operating mode",
    "  -h, --help            -v, --version            System information",
    "", "  Next  switchbay",
  );
  return lines.join("\n");
}
