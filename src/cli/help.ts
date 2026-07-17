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

const SUBCOMMAND_HELP: Record<string, string[]> = {
  "models": [
    "  switchbay models",
    "",
    "  Browse and manage the model runtime.",
    "",
    "  USAGE",
    "    switchbay models [--lane <lane>]",
    "    switchbay models list [--all] [--lane <lane>]",
    "    switchbay models clear [--lane cloud]",
    "",
    "  SUBCOMMANDS",
    "    list       Show available models for the current lane  (default)",
    "    clear      Remove custom cloud models",
    "",
    "  OPTIONS",
    "    --lane <lane>   Filter by lane: cloud | local | apple | openrouter | huggingface",
    "    --all           Show every lane in one sectioned view  (list only)",
    "",
    "  EXAMPLES",
    "    switchbay models                        Cloud models (current provider)",
    "    switchbay models --lane apple           Apple Intelligence models",
    "    switchbay models --lane local           Local Ollama models",
    "    switchbay models list --all             All lanes in one view",
    "    switchbay models clear --lane cloud     Reset the cloud catalog",
  ],
  "models list": [
    "  switchbay models list",
    "",
    "  Show available models for a runtime lane.",
    "",
    "  USAGE",
    "    switchbay models list [--lane <lane>] [--all]",
    "",
    "  OPTIONS",
    "    --lane <lane>   Lane to list: cloud | local | apple | openrouter | huggingface",
    "    --all           Show all lanes together in one sectioned view",
    "",
    "  EXAMPLES",
    "    switchbay models list                   Cloud models",
    "    switchbay models list --lane local      Ollama models",
    "    switchbay models list --all             Every lane at once",
  ],
  "model": [
    "  switchbay model",
    "",
    "  Inspect or pin the active model for a runtime lane.",
    "",
    "  USAGE",
    "    switchbay model [<lane>] [<model-id>|auto]",
    "    switchbay model pull <model> [--quant <q>] [-y]",
    "    switchbay model add <id> [--lane cloud] [-y]",
    "    switchbay model remove [<lane>]",
    "    switchbay model verify [<lane>]",
    "",
    "  ACTIONS",
    "    (none)     Show the active model and lane",
    "    pull       Download and install a local model via Ollama",
    "    add        Add a cloud model to the catalog",
    "    remove     Unpin the model for a lane",
    "    verify     Test connectivity for the current model",
    "",
    "  OPTIONS",
    "    --lane <lane>          Target lane (cloud | local | apple | …)",
    "    --quant, -q <level>    Quantization hint for Ollama pulls",
    "    --label, --name <s>    Friendly label for model add",
    "    --yes, -y              Skip confirmation prompts",
    "",
    "  EXAMPLES",
    "    switchbay model                         Show current routing",
    "    switchbay model cloud claude-opus-4-8   Pin Anthropic model on cloud lane",
    "    switchbay model pull llama3.2 -y        Pull and install Llama 3.2",
    "    switchbay model add gpt-4o -y           Add GPT-4o to cloud catalog",
    "    switchbay model verify                  Ping the active model",
  ],
  "engines": [
    "  switchbay engines",
    "",
    "  Manage Engine Bay tools — standalone programs your workspace can call.",
    "",
    "  USAGE",
    "    switchbay engines [<action>]",
    "",
    "  ACTIONS",
    "    status      Show Engine Bay state and engine count  (default)",
    "    list        List all installed engines and their tools",
    "    templates   Show engine scaffold templates",
    "    sync        Pull the latest engine definitions",
    "",
    "  EXAMPLES",
    "    switchbay engines                       Engine Bay status",
    "    switchbay engines list                  All engines",
    "    switchbay engines sync                  Refresh from remote",
  ],
  "skills": [
    "  switchbay skills",
    "",
    "  Manage the Skill Library — prompt guides that shape how Claude works.",
    "",
    "  USAGE",
    "    switchbay skills [<action>] [<skill-name>]",
    "",
    "  ACTIONS",
    "    status      Show Skill Library state  (default)",
    "    list        List all installed skills",
    "    read <name> Read a specific skill's content",
    "    templates   Show skill scaffold templates",
    "    sync        Pull the latest skill definitions",
    "",
    "  EXAMPLES",
    "    switchbay skills                        Skill Library status",
    "    switchbay skills list                   All skills",
    "    switchbay skills read code-review       Read the code-review skill",
    "    switchbay skills sync                   Refresh from remote",
  ],
};

export function renderSubcommandHelp(context: string, color = cliColorEnabled()): string {
  const lines = SUBCOMMAND_HELP[context];
  if (!lines) {
    return [
      cliHeader(`switchbay ${context}`, "Subcommand help", color),
      "",
      `  No detailed help available for "${context}". Try: switchbay --help`,
    ].join("\n");
  }
  return [cliHeader(`switchbay ${context}`, "Command reference", color), "", ...lines, ""].join("\n");
}

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
    "  --lane <lane>                                  cloud | local | apple | openai | anthropic | gemini | cloud-mcp | ollama-cloud | openrouter | huggingface",
    "  --hop <workspace>                              Open another known workspace",
    "  --vision <path|url>                            Attach an image for this turn",
    "  --new                                          Start a clean session",
    "  --deep-research                                Run structured multi-step research (search → read → instance → report)",
    "  --purge <1d|1w|...>                            Remove older saved sessions",
    "  -s, --surface <type>  -p, --profile <name>     Set working context",
    "  -m, --mode <build|design|debug>                Set operating mode",
    "  -h, --help            -v, --version            System information",
    "", "  Next  switchbay",
  );
  return lines.join("\n");
}
