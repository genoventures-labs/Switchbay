import { DEFAULTS } from "../config/defaults";

export type CliOptions = {
  surface: string;
  profile: string;
  mode: string;
  lane: string | null;
  initialQuery: string;
  hop: string | null;
  resume: string | boolean; // string (id/index) or true (latest)
  newSession: boolean;
  purge: string | null;
  subcommand: "run" | "update" | "version" | "help" | "engines" | "skills" | "toolbox" | "plugins" | "memory" | "knowledge" | "trace" | "mcp";
  engineAction: "status" | "sync" | "list" | "templates";
  toolboxAction: "status" | "sync" | "list" | "templates" | "read";
  toolboxSkill: string | null;
  pluginAction?: "status" | "list" | "inspect";
  pluginId?: string | null;
  memoryAction: "status" | "refresh" | "list" | "facts";
  knowledgeAction: "status" | "refresh" | "search";
  knowledgeQuery: string | null;
  traceAction: "last" | "export";
  mcpAction: "status" | "init" | "catalog";
};

export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let surface: string = DEFAULTS.surface;
  let profile: string = DEFAULTS.profile;
  let mode: string = DEFAULTS.mode;
  let lane: string | null = null;
  let hop: string | null = null;
  let resume: string | boolean = false;
  let newSession = false;
  let purge: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" || arg === "--surface") {
      surface = args[++i] ?? DEFAULTS.surface;
    } else if (arg === "-p" || arg === "--profile") {
      profile = args[++i] ?? DEFAULTS.profile;
    } else if (arg === "-m" || arg === "--mode") {
      mode = args[++i] ?? DEFAULTS.mode;
    } else if (arg === "--lane") {
      lane = args[++i] ?? null;
    } else if (arg === "--hop") {
      hop = args[++i] ?? null;
    } else if (arg === "--resume") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        resume = next;
        i++;
      } else {
        resume = true;
      }
    } else if (arg === "--new") {
      newSession = true;
    } else if (arg === "--purge") {
      purge = args[++i] ?? null;
    } else if (arg === "engines" || arg === "engine-bay") {
      const action = args[i + 1];
      const engineAction = action === "sync" || action === "list" || action === "templates" || action === "status"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "engines",
        engineAction,
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
      };
    } else if (arg === "skills" || arg === "toolbox") {
      const action = args[i + 1];
      const toolboxAction = action === "sync" || action === "list" || action === "templates" || action === "read" || action === "status"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: arg === "skills" ? "skills" : "toolbox",
        engineAction: "status",
        toolboxAction,
        toolboxSkill: toolboxAction === "read" ? args[i + 2] ?? null : null,
        memoryAction: "status",
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
      };
    } else if (arg === "plugins") {
      const action = args[i + 1];
      const pluginAction = action === "list" || action === "inspect" || action === "status"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "plugins",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        pluginAction,
        pluginId: pluginAction === "inspect" ? args[i + 2] ?? null : null,
        memoryAction: "status",
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
      };
    } else if (arg === "memory") {
      const action = args[i + 1];
      const memoryAction = action === "refresh" || action === "list" || action === "facts" || action === "status"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "memory",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
      };
    } else if (arg === "knowledge" || arg === "index") {
      const action = args[i + 1];
      const knowledgeAction = action === "refresh" || action === "search" || action === "status"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "knowledge",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        knowledgeAction,
        knowledgeQuery: knowledgeAction === "search" ? args.slice(i + 2).join(" ") || null : null,
        traceAction: "last",
        mcpAction: "status",
      };
    } else if (arg === "trace") {
      const action = args[i + 1];
      const traceAction = action === "export" ? "export" : "last";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "trace",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction,
        mcpAction: "status",
      };
    } else if (arg === "mcp") {
      const action = args[i + 1];
      const mcpAction = action === "init" || action === "status" || action === "catalog"
        ? action
        : "status";
      return {
        surface,
        profile,
        mode,
        lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "mcp",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction,
      };
    } else if (arg === "update") {
      console.log("Run this to update Switchbay from source:\n");
      console.log("  bun install -g github:genoventures-labs/Switchbay#main\n");
      console.log("Or, if installed through Homebrew:\n");
      console.log("  brew upgrade switchbay\n");
      process.exit(0);
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      console.log("switchbay 0.9.81");
      process.exit(0);
    } else if (arg === undefined || arg === "help" || arg === "--help" || arg === "-h") {
      return { surface, profile, mode, lane, initialQuery: "", hop: null, resume: false, newSession: false, purge: null, subcommand: "help", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status" };
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return {
    surface,
    profile,
    mode,
    lane,
    initialQuery: positional.join(" "),
    hop,
    resume,
    newSession,
    purge,
    subcommand: "run",
    engineAction: "status",
    toolboxAction: "status",
    toolboxSkill: null,
    memoryAction: "status",
    knowledgeAction: "status",
    knowledgeQuery: null,
    traceAction: "last",
    mcpAction: "status",
  };
}
