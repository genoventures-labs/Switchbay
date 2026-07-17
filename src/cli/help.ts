import { cliHeader, cliColorEnabled } from "./presentation";
import { SWITCHBAY_VERSION } from "../version";

// ── ANSI helpers (local, not exported from presentation) ──────────────────────
const A = {
  reset:  "[0m",
  bold:   "[1m",
  muted:  "[38;5;244m",
  bright: "[38;5;51m",
  cyan:   "[38;5;44m",
};
function p(s: string, code: string, color: boolean): string {
  return color ? `${code}${s}${A.reset}` : s;
}

// ── Layout constants ──────────────────────────────────────────────────────────
const RULE_WIDTH  = 68;   // total width of a section rule line (after 2-char indent)
const CMD_COL     = 26;   // visible chars reserved for the subcommand + args
const SB          = "switchbay";
const SB_LEN      = SB.length + 1; // "switchbay " = 10

// ── Primitives ────────────────────────────────────────────────────────────────
function rule(label: string, color: boolean): string {
  const dashes = "─".repeat(Math.max(0, RULE_WIDTH - label.length - 1));
  return `\n  ${p(label, A.bold, color)} ${p(dashes, A.muted, color)}`;
}

/**
 * Format one command line.
 * sub: everything after "switchbay " e.g. `models [--lane <lane>]`
 *   or "" for the bare `switchbay` invocation.
 * Special: if sub starts with a quote-like char it's shown as a literal arg.
 */
function cmd(sub: string, desc: string, color: boolean): string {
  const prefix = `  ${p(SB, A.muted, color)} `;

  if (sub === "") {
    // bare `switchbay` — just show prefix with no subcommand
    const pad = " ".repeat(CMD_COL);
    return `${prefix}${pad}  ${desc}`;
  }

  // Split bare subcommand from optional args
  // e.g. "models [--lane <lane>]" → bare="models", rest=" [--lane <lane>]"
  const spaceIdx = sub.indexOf(" ");
  const bare = spaceIdx >= 0 ? sub.slice(0, spaceIdx) : sub;
  const rest  = spaceIdx >= 0 ? sub.slice(spaceIdx)   : "";

  const restColored = rest ? p(rest, A.muted, color) : "";
  const visibleLen  = sub.length; // bare + rest (no ANSI in source)
  const pad = " ".repeat(Math.max(1, CMD_COL - visibleLen));

  return `${prefix}${bare}${restColored}${pad}  ${desc}`;
}

function flag(name: string, desc: string, color: boolean): string {
  const FLAG_COL = 18;
  const pad = " ".repeat(Math.max(1, FLAG_COL - name.length));
  return `  ${p(name, A.muted, color)}${pad}${desc}`;
}

// ── Main help ─────────────────────────────────────────────────────────────────

export function renderCliHelp(color = cliColorEnabled()): string {
  const ver = p(`v${SWITCHBAY_VERSION}`, A.muted, color);
  const header = `${p("◆", A.bright, color)} ${p("Switchbay", A.bold, color)}  ${ver}  ${p("·  Local AI work system", A.muted, color)}`;

  const lines: string[] = [header, ""];

  // ── GETTING STARTED ────────────────────────────────────────────────
  lines.push(rule("GETTING STARTED", color));
  lines.push(cmd("",                            "Open the terminal workspace",         color));
  lines.push(cmd('"<request>"',                 "Run a one-shot request",              color));
  lines.push(cmd("--resume [id]",               "Continue a saved session",            color));
  lines.push(cmd("agenda",                      "Today's Daily Board",                 color));
  lines.push(cmd("open",                        "Open the visual web workspace",       color));

  // ── MODELS ────────────────────────────────────────────────────────
  lines.push(rule("MODELS", color));
  lines.push(cmd("model",                       "Show active model and lane",          color));
  lines.push(cmd("models [--lane <lane>]",      "Browse the model catalog",            color));
  lines.push(cmd("models list --all",           "All lanes in one view",               color));
  lines.push(cmd("model pull <id>",             "Install a local model via Ollama",    color));
  lines.push(cmd("model add <id>",              "Add a model to the cloud catalog",    color));
  lines.push(cmd("local-mode set <mode>",       "Route to local or offline only",      color));

  // ── CAPABILITIES ──────────────────────────────────────────────────
  lines.push(rule("CAPABILITIES", color));
  lines.push(cmd("engines list",                "Installed Engine Bay tools",          color));
  lines.push(cmd("skills list",                 "Skill Library guides",                color));
  lines.push(cmd("agents list",                 "Specialist agent workers",            color));
  lines.push(cmd("mcp catalog",                 "MCP tool bridge catalog",             color));
  lines.push(cmd("plugins list",                "Installed capability packs",          color));

  // ── WORKSPACE ─────────────────────────────────────────────────────
  lines.push(rule("WORKSPACE", color));
  lines.push(cmd("memory",                      "Workspace memory and facts",          color));
  lines.push(cmd("knowledge search <query>",    "Query indexed documents",             color));
  lines.push(cmd("task add / done / clear",     "Today's task list",                   color));
  lines.push(cmd("handoff",                     "Wrap session and prep next",          color));

  // ── INSPECTION ────────────────────────────────────────────────────
  lines.push(rule("INSPECTION", color));
  lines.push(cmd("trace",                       "Last turn ledger",                    color));
  lines.push(cmd("usage",                       "Turns, tokens, tools, spend",         color));
  lines.push(cmd("radar",                       "Friction Radar preflight check",      color));
  lines.push(cmd("graph trace",                 "Execution flow visualizer",           color));

  // ── SYSTEM ────────────────────────────────────────────────────────
  lines.push(rule("SYSTEM", color));
  lines.push(cmd("update",                      "Update, rebuild, and refresh",        color));
  lines.push(cmd("serve [--detach]",            "Start the local API server",          color));
  lines.push(cmd("service status",              "Manage the startup service",          color));

  // ── FLAGS ─────────────────────────────────────────────────────────
  lines.push(rule("FLAGS", color));
  lines.push(flag("--lane <lane>",   "cloud · local · apple · openrouter · huggingface", color));
  lines.push(flag("--hop <path>",    "Switch to another workspace",                       color));
  lines.push(flag("--vision <img>",  "Attach an image to this turn",                      color));
  lines.push(flag("--new",           "Start a clean session",                             color));
  lines.push(flag("--resume [id]",   "Resume a saved session",                            color));
  lines.push(flag("--mode <mode>",   "build · design · debug",                            color));
  lines.push(flag("--deep-research", "Structured multi-step research",                    color));

  // ── Footer ────────────────────────────────────────────────────────
  lines.push("");
  const tip = `${p(SB, A.muted, color)} ${p("<command> --help", A.cyan, color)}  ${p("·", A.muted, color)}  ${p(SB, A.muted, color)} ${p("version", A.cyan, color)}`;
  lines.push(`  ${tip}`);
  lines.push("");

  return lines.join("\n");
}

// ── Subcommand help ───────────────────────────────────────────────────────────

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
  "local-mode": [
    "  switchbay local-mode",
    "",
    "  Pin inference to local models only. Cloud calls are gated behind a",
    "  per-task confirm prompt. Offline mode also disables network tools.",
    "",
    "  USAGE",
    "    switchbay local-mode",
    "    switchbay local-mode set <mode>",
    "",
    "  MODES",
    "    off       Default — all lanes available, no restrictions",
    "    local     Local inference only; network tools (web search) still work",
    "    offline   Local inference + network tools disabled",
    "",
    "  When local mode is active and auto-routing picks a cloud AFM variant,",
    "  Switchbay asks: \"Switch to cloud for this task? [y/N]\"",
    "  Answering yes sends the turn to Apple Private Cloud Compute (PCC).",
    "  Answering no falls back to AFM 3 Core Advanced (on-device).",
    "",
    "  EXAMPLES",
    "    switchbay local-mode                  Show current mode",
    "    switchbay local-mode set local        Local inference, web tools on",
    "    switchbay local-mode set offline      Full air-gap (no network tools)",
    "    switchbay local-mode set off          Restore default routing",
    "",
    "  ENV OVERRIDE",
    "    SWITCHBAY_LOCAL_MODE=local|offline    Override config for one session",
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
