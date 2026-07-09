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
  subcommand: "run" | "update" | "version" | "help" | "engines" | "skills" | "toolbox" | "plugins" | "agents" | "memory" | "knowledge" | "trace" | "radar" | "handoff" | "mcp" | "models" | "model" | "local-provider" | "cloud-provider" | "agenda" | "task";
  engineAction: "status" | "sync" | "list" | "templates";
  toolboxAction: "status" | "sync" | "list" | "templates" | "read";
  toolboxSkill: string | null;
  pluginAction?: "status" | "list" | "inspect";
  pluginId?: string | null;
  agentAction?: "status" | "list" | "create" | "read";
  agentId?: string | null;
  agentName?: string | null;
  agentSpecialty?: string | null;
  agentApproach?: string | null;
  agentRules?: string | null;
  agentScope?: "user" | "workspace";
  memoryAction: "status" | "refresh" | "list" | "facts" | "add";
  memoryNote: string | null;
  knowledgeAction: "status" | "refresh" | "search";
  knowledgeQuery: string | null;
  traceAction: "last" | "export";
  mcpAction: "status" | "init" | "catalog";
  localProviderAction?: "status" | "set";
  localProviderTarget?: string | null;
  cloudProviderAction?: "status" | "set";
  cloudProviderTarget?: string | null;
  taskAction?: "status" | "add" | "done" | "clear";
  taskText?: string | null;
  taskId?: number | null;
  modelAction?: "show" | "set" | "pull" | "add";
  modelTarget: string | null;
  modelLane: string | null;
  modelQuantization?: string | null;
  modelLabel?: string | null;
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
    } else if (arg === "--add-model") {
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
        subcommand: "model",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelAction: "add",
        modelTarget: args[++i] ?? null,
        modelLane: null,
        modelLabel: readLabelFlag(args.slice(i + 1)),
      };
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
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
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
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
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
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "agents" || arg === "agent") {
      const parsedAgent = parseAgentCommand(args.slice(i + 1));
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
        subcommand: "agents",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        pluginAction: "status",
        pluginId: null,
        agentAction: parsedAgent.action,
        agentId: parsedAgent.id,
        agentName: parsedAgent.name,
        agentSpecialty: parsedAgent.specialty,
        agentApproach: parsedAgent.approach,
        agentRules: parsedAgent.rules,
        agentScope: parsedAgent.scope,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "memory") {
      const action = args[i + 1];
      const memoryAction = action === "refresh" || action === "list" || action === "facts" || action === "status" || action === "add" || action === "remember"
        ? action === "remember" ? "add" : action
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
        memoryNote: memoryAction === "add" ? args.slice(i + 2).join(" ") || null : null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "agenda" || arg === "today") {
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
        subcommand: "agenda",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "task" || arg === "tasks") {
      const parsedTask = parseTaskCommand(args.slice(i + 1));
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
        subcommand: "task",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        taskAction: parsedTask.action,
        taskText: parsedTask.text,
        taskId: parsedTask.id,
        modelTarget: null,
        modelLane: null,
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
        memoryNote: null,
        knowledgeAction,
        knowledgeQuery: knowledgeAction === "search" ? args.slice(i + 2).join(" ") || null : null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
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
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction,
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "radar" || arg === "preflight") {
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
        subcommand: "radar",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "handoff" || arg === "wrap") {
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
        subcommand: "handoff",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
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
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction,
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "local-provider" || arg === "local-providers" || arg === "provider") {
      const action = args[i + 1];
      const localProviderAction = action === "set" ? "set" : "status";
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
        subcommand: "local-provider",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        localProviderAction,
        localProviderTarget: localProviderAction === "set" ? args[i + 2] ?? null : null,
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "cloud-provider" || arg === "cloud-providers" || arg === "cloud-router") {
      const action = args[i + 1];
      const cloudProviderAction = action === "set" ? "set" : "status";
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
        subcommand: "cloud-provider",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        cloudProviderAction,
        cloudProviderTarget: cloudProviderAction === "set" ? args[i + 2] ?? null : null,
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "models") {
      const commandLane = readLaneFlag(args.slice(i + 1));
      return {
        surface,
        profile,
        mode,
        lane: commandLane ?? lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "models",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelTarget: null,
        modelLane: null,
      };
    } else if (arg === "model") {
      const parsedModel = parseModelCommand(args.slice(i + 1));
      return {
        surface,
        profile,
        mode,
        lane: parsedModel.flagLane ?? lane,
        initialQuery: "",
        hop,
        resume,
        newSession,
        purge,
        subcommand: "model",
        engineAction: "status",
        toolboxAction: "status",
        toolboxSkill: null,
        memoryAction: "status",
        memoryNote: null,
        knowledgeAction: "status",
        knowledgeQuery: null,
        traceAction: "last",
        mcpAction: "status",
        modelAction: parsedModel.action,
        modelTarget: parsedModel.target,
        modelLane: parsedModel.commandLane,
        modelQuantization: parsedModel.quantization,
        modelLabel: parsedModel.label,
      };
    } else if (arg === "update") {
      console.log("Run this to update Switchbay from source:\n");
      console.log("  bun install -g github:genoventures-labs/Switchbay#main\n");
      console.log("Or, if installed through Homebrew:\n");
      console.log("  brew upgrade switchbay\n");
      process.exit(0);
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      console.log("switchbay 1.5.6");
      process.exit(0);
    } else if (arg === undefined || arg === "help" || arg === "--help" || arg === "-h") {
      return { surface, profile, mode, lane, initialQuery: "", hop: null, resume: false, newSession: false, purge: null, subcommand: "help", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
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
    memoryNote: null,
    knowledgeAction: "status",
    knowledgeQuery: null,
    traceAction: "last",
    mcpAction: "status",
    modelTarget: null,
    modelLane: null,
  };
}

type ParsedModelCommand = {
  action: "show" | "set" | "pull" | "add";
  commandLane: string | null;
  flagLane: string | null;
  target: string | null;
  quantization: string | null;
  label: string | null;
};

type ParsedAgentCommand = {
  action: "status" | "list" | "create" | "read";
  id: string | null;
  name: string | null;
  specialty: string | null;
  approach: string | null;
  rules: string | null;
  scope: "user" | "workspace";
};

type ParsedTaskCommand = {
  action: "status" | "add" | "done" | "clear";
  text: string | null;
  id: number | null;
};

function parseAgentCommand(args: string[]): ParsedAgentCommand {
  const rest: string[] = [];
  let name: string | null = null;
  let specialty: string | null = null;
  let approach: string | null = null;
  let rules: string | null = null;
  let scope: "user" | "workspace" = "workspace";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" || arg === "-n") {
      name = args[++i] ?? null;
    } else if (arg === "--specialty" || arg === "--role" || arg === "-s") {
      specialty = args[++i] ?? null;
    } else if (arg === "--approach" || arg === "--style") {
      approach = args[++i] ?? null;
    } else if (arg === "--rules" || arg === "--guardrails") {
      rules = args[++i] ?? null;
    } else if (arg === "--scope") {
      const next = args[++i];
      scope = next === "user" || next === "global" ? "user" : "workspace";
    } else if (arg === "--user" || arg === "--global") {
      scope = "user";
    } else if (arg === "--workspace" || arg === "--local") {
      scope = "workspace";
    } else {
      rest.push(arg!);
    }
  }

  const action = rest[0] === "create" || rest[0] === "new"
    ? "create"
    : rest[0] === "read" || rest[0] === "show" || rest[0] === "inspect"
      ? "read"
      : rest[0] === "list" || rest[0] === "ls"
        ? "list"
        : "status";

  const id = action === "read" ? rest[1] ?? null : null;
  if (action === "create" && !name && rest[1]) name = rest[1];
  if (action === "create" && !specialty && rest.length > 2) specialty = rest.slice(2).join(" ");

  return { action, id, name, specialty, approach, rules, scope };
}

function parseTaskCommand(args: string[]): ParsedTaskCommand {
  const action = args[0];
  if (action === "add" || action === "remember" || action === "remind") {
    return { action: "add", text: args.slice(1).join(" ") || null, id: null };
  }
  if (action === "done" || action === "complete" || action === "finish") {
    return { action: "done", text: null, id: parsePositiveInt(args[1]) };
  }
  if (action === "clear" || action === "reset") {
    return { action: "clear", text: null, id: null };
  }
  return { action: "status", text: null, id: null };
}

function parseModelCommand(args: string[]): ParsedModelCommand {
  const rest: string[] = [];
  let flagLane: string | null = null;
  let quantization: string | null = null;
  let label: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lane") {
      flagLane = args[++i] ?? null;
    } else if (args[i] === "--quant" || args[i] === "--quantization" || args[i] === "-q") {
      quantization = args[++i] ?? null;
    } else if (args[i] === "--label" || args[i] === "--name") {
      label = args[++i] ?? null;
    } else {
      rest.push(args[i]!);
    }
  }

  const action = rest[0] === "pull" ? "pull" : rest[0] === "add" ? "add" : rest.length ? "set" : "show";
  const actionRest = action === "pull" || action === "add" ? rest.slice(1) : rest;
  const first = actionRest[0] ?? null;
  const second = actionRest[1] ?? null;
  const inferredLabel = action === "add" && !label && first && second && isLaneAlias(first)
    ? actionRest.slice(2).join(" ") || null
    : action === "add" && !label && first && !isLaneAlias(first)
      ? actionRest.slice(1).join(" ") || null
      : label;
  const firstIsLane = isLaneAlias(first);
  return {
    action,
    commandLane: firstIsLane ? first : null,
    flagLane,
    target: firstIsLane ? second : first,
    quantization,
    label: inferredLabel,
  };
}

function readLaneFlag(args: string[]): string | null {
  const index = args.indexOf("--lane");
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readLabelFlag(args: string[]): string | null {
  const index = args.findIndex((arg) => arg === "--label" || arg === "--name");
  return index >= 0 ? args[index + 1] ?? null : null;
}

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isLaneAlias(value: string | null): boolean {
  return value === "cloud" ||
    value === "cloud-mcp" ||
    value === "mcp" ||
    value === "local" ||
    value === "local-mcp" ||
    value === "native-mcp" ||
    value === "lm" ||
    value === "lmstudio" ||
    value === "lm-studio" ||
    value === "ollama" ||
    value === "openai" ||
    value === "open-ai" ||
    value === "gpt" ||
    value === "anthropic" ||
    value === "claude" ||
    value === "google" ||
    value === "gemini";
}
