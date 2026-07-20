import { DEFAULTS } from "../config/defaults";
import { SWITCHBAY_VERSION } from "../version";

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
  visionPath?: string | null;
  detach?: boolean;
  subcommand: "run" | "open" | "web-serve" | "serve" | "service" | "update" | "version" | "help" | "engines" | "skills" | "toolbox" | "plugins" | "agents" | "memory" | "knowledge" | "trace" | "usage" | "graph" | "radar" | "handoff" | "mcp" | "models" | "model" | "local-provider" | "cloud-provider" | "local-mode" | "agenda" | "task" | "brief" | "docs" | "sync" | "benchmark" | "inspect" | "images" | "extension" | "litert";
  inspectImagePath?: string | null;
  inspectQuestion?: string | null;
  inspectTask?: string | null;
  benchmarkModel?: string | null;
  benchmarkLane?: string | null;
  benchmarkPre?: boolean;
  benchmarkTrusted?: boolean;
  graphAction?: "trace";
  serviceAction?: "install" | "status" | "restart" | "uninstall";
  engineAction: "status" | "sync" | "list" | "templates" | "health";
  engineFix?: boolean;
  toolboxAction: "status" | "sync" | "list" | "templates" | "read" | "health";
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
  modelsAction?: "list" | "clear" | "verify";
  modelsAll?: boolean;
  modelsTrusted?: boolean;
  modelsProvider?: string | null;
  helpContext?: string;
  localModeAction?: "status" | "set";
  localModeValue?: string | null;
  modelAction?: "show" | "set" | "pull" | "add" | "remove" | "verify";
  modelTarget: string | null;
  modelLane: string | null;
  modelQuantization?: string | null;
  modelLabel?: string | null;
  yes?: boolean;
  deepResearch?: boolean;
  briefAction?: "list" | "create" | "draft";
  briefName?: string | null;
  briefPrompt?: string | null;
  extensionAction?: "serve" | "stop" | "status" | "logs";
  liteRtAction?: "serve" | "stop" | "status" | "logs" | "list" | "models" | "import" | "delete";
  liteRtImportRepo?: string | null;
  liteRtImportFile?: string | null;
  liteRtImportId?: string | null;
  liteRtDeleteId?: string | null;
  liteRtBackend?: "gpu" | "cpu" | null;
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
  let visionPath: string | null = null;
  let yes = false;
  let deepResearch = false;
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
    } else if (arg === "--vision" || arg === "--image") {
      const target = args[++i];
      if (!target || target.startsWith("-")) throw new Error(`${arg} requires an image path or URL`);
      visionPath = target;
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
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--deep-research" || arg === "-dr") {
      deepResearch = true;
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
        yes,
      };
    } else if (arg === "open" || arg === "web-serve") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: arg, engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "serve") {
      const detach = args.includes("--detach") || args.includes("-d");
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "serve", detach, engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "service") {
      const action = args[i + 1];
      assertCliAction("service", action, ["install", "status", "restart", "uninstall"]);
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "service", serviceAction: action === "install" || action === "restart" || action === "uninstall" ? action : "status",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null,
        knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "engines" || arg === "engine-bay") {
      if (args.slice(i + 1).includes("--help") || args.slice(i + 1).includes("-h")) {
        return { surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge, subcommand: "help", helpContext: "engines", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
      }
      const action = args[i + 1];
      assertCliAction("engines", action, ["sync", "list", "templates", "status", "health"]);
      const engineAction = action === "sync" || action === "list" || action === "templates" || action === "status" || action === "health"
        ? action
        : "status";
      const engineFix = args.slice(i + 1).includes("--fix");
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
        engineFix,
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
      if (args.slice(i + 1).includes("--help") || args.slice(i + 1).includes("-h")) {
        return { surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge, subcommand: "help", helpContext: "skills", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
      }
      const action = args[i + 1];
      assertCliAction(arg, action, ["sync", "list", "templates", "read", "status", "health"]);
      const toolboxAction = action === "sync" || action === "list" || action === "templates" || action === "read" || action === "status" || action === "health"
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
      assertCliAction("plugins", action, ["list", "inspect", "status"]);
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
    } else if (arg === "memory" || arg === "memories" || arg === "remember") {
      const action = args[i + 1];
      const memoryAction = action === "refresh" || action === "list" || action === "facts" || action === "status" || action === "add" || action === "remember"
        ? action === "remember" ? "add" : action
        : arg === "memories" ? "list"
        : arg === "remember" ? "add"
        : "status";
      const noteStart = arg === "remember" ? i + 1 : i + 2;
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
        memoryNote: memoryAction === "add" ? args.slice(noteStart).join(" ") || null : null,
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
    } else if (arg === "inspect" || arg === "vision") {
      const imagePath = args[i + 1] && !args[i + 1]!.startsWith("-") ? args[i + 1]! : null;
      const rest = args.slice(imagePath ? i + 2 : i + 1);
      const questionIdx = rest.findIndex((a) => a === "--question" || a === "-q");
      const inspectQuestion = questionIdx >= 0 ? rest[questionIdx + 1] ?? null : null;
      const taskIdx = rest.findIndex((a) => a === "--task");
      const inspectTask = taskIdx >= 0 ? rest[taskIdx + 1] ?? null : null;
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "inspect", inspectImagePath: imagePath, inspectQuestion, inspectTask,
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "images" || arg === "image-store") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "images",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "extension" || arg === "ext") {
      const action = rest[0] ?? "serve";
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "extension",
        extensionAction: action === "stop" || action === "status" || action === "logs" ? action : "serve",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "litert" || arg === "litert-lm" || arg === "edge") {
      const action = rest[0] ?? "status";
      // litert import <hf-repo> <filename> <id>
      const liteRtImportRepo = action === "import" ? (rest[1] ?? null) : null;
      const liteRtImportFile = action === "import" ? (rest[2] ?? null) : null;
      const liteRtImportId   = action === "import" ? (rest[3] ?? null) : null;
      const liteRtDeleteId   = action === "delete" || action === "remove" ? (rest[1] ?? null) : null;
      const liteRtBackend    = args.includes("--gpu") ? "gpu" : args.includes("--cpu") ? "cpu" : null;
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "litert",
        liteRtAction: (["serve", "stop", "status", "logs", "list", "models", "import", "delete"].includes(action) ? action : "status") as "serve" | "stop" | "status" | "logs" | "list" | "models" | "import" | "delete",
        liteRtImportRepo, liteRtImportFile, liteRtImportId, liteRtDeleteId,
        liteRtBackend: liteRtBackend as "gpu" | "cpu" | null,
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "benchmark" || arg === "bench") {
      // switchbay benchmark [model] [--lane <lane>]
      let benchmarkModel: string | null = null;
      let benchmarkLane: string | null = lane;
      let benchmarkPre = false;
      let benchmarkTrusted = false;
      while (i + 1 < args.length) {
        const next = args[i + 1]!;
        if (next === "--lane" && args[i + 2]) { benchmarkLane = args[i + 2]!; i += 2; }
        else if (next === "--pre") { benchmarkPre = true; i++; }
        else if (next === "--trusted") { benchmarkTrusted = true; i++; }
        else if (!next.startsWith("-")) { benchmarkModel = next; i++; }
        else break;
      }
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "benchmark", benchmarkModel, benchmarkLane, benchmarkPre, benchmarkTrusted,
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null,
        knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status",
        modelTarget: null, modelLane: null,
      };
    } else if (arg === "sync") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "sync",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null,
        knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status",
        modelTarget: null, modelLane: null,
      };
    } else if (arg === "docs" || arg === "wiki") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "docs",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null,
        knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status",
        modelTarget: null, modelLane: null,
      };
    } else if (arg === "brief" || arg === "briefs") {
      const sub = args[i + 1];
      let briefAction: "list" | "create" | "draft" = "list";
      let briefName: string | null = null;
      let briefPrompt: string | null = null;
      if (sub === "create") {
        briefAction = "create";
        briefName = args.slice(i + 2).join(" ") || null;
      } else if (sub === "draft") {
        briefAction = "draft";
        // --name <name> and remaining args as prompt
        const nameIdx = args.indexOf("--name", i + 2);
        if (nameIdx !== -1) {
          briefName = args[nameIdx + 1] ?? null;
          const promptArgs = args.slice(i + 2).filter((_, idx) => idx !== nameIdx - (i + 2) && idx !== nameIdx - (i + 2) + 1);
          briefPrompt = promptArgs.join(" ") || null;
        } else {
          briefPrompt = args.slice(i + 2).join(" ") || null;
        }
      }
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "brief",
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null,
        knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status",
        modelTarget: null, modelLane: null,
        briefAction, briefName, briefPrompt,
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
    } else if (arg === "usage") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "usage", engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
      };
    } else if (arg === "graph") {
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "graph", graphAction: "trace", engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
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
    } else if (arg === "local-mode" || arg === "offline" || arg === "local-first") {
      if (args.slice(i + 1).includes("--help") || args.slice(i + 1).includes("-h")) {
        return { surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge, subcommand: "help", helpContext: "local-mode", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
      }
      const action = args[i + 1];
      const localModeAction = action === "set" ? "set" : "status";
      const localModeValue = localModeAction === "set" ? args[i + 2] ?? null : null;
      return {
        surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge,
        subcommand: "local-mode", localModeAction, localModeValue,
        engineAction: "status", toolboxAction: "status", toolboxSkill: null,
        memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null,
        traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null,
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
      const rest = args.slice(i + 1);
      if (rest.includes("--help") || rest.includes("-h")) {
        const sub = rest[0] === "list" || rest[0] === "clear" ? `models ${rest[0]}` : "models";
        return { surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge, subcommand: "help", helpContext: sub, engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
      }
      const modelsAction: "list" | "clear" | "verify" = rest[0] === "clear" ? "clear" : rest[0] === "verify" ? "verify" : "list";
      const modelsAll = rest.includes("--all");
      const modelsTrusted = rest.includes("--trusted");
      const modelsProvider = readProviderFlag(modelsAction === "clear" ? rest.slice(1) : rest);
      const commandLane = readLaneFlag(modelsAction === "clear" ? rest.slice(1) : rest);
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
        modelsAction,
        modelsAll,
        modelsTrusted,
        modelsProvider,
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
      if (args.slice(i + 1).includes("--help") || args.slice(i + 1).includes("-h")) {
        return { surface, profile, mode, lane, initialQuery: "", hop, resume, newSession, purge, subcommand: "help", helpContext: "model", engineAction: "status", toolboxAction: "status", toolboxSkill: null, memoryAction: "status", memoryNote: null, knowledgeAction: "status", knowledgeQuery: null, traceAction: "last", mcpAction: "status", modelTarget: null, modelLane: null };
      }
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
        yes: yes || parsedModel.yes,
      };
    } else if (arg === "update") {
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
        subcommand: "update",
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
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      console.log(`switchbay ${SWITCHBAY_VERSION}`);
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
    initialQuery: positional.join(" ") || (visionPath ? "Inspect this image." : ""),
    hop,
    resume,
    newSession,
    purge,
    visionPath,
    deepResearch,
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

function assertCliAction(command: string, action: string | undefined, allowed: string[]): void {
  if (!action || action.startsWith("-")) return;
  if (!allowed.includes(action)) {
    throw new Error(`Unknown ${command} action "${action}". Choose: ${allowed.join(", ")}.`);
  }
}

type ParsedModelCommand = {
  action: "show" | "set" | "pull" | "add" | "remove" | "verify";
  commandLane: string | null;
  flagLane: string | null;
  target: string | null;
  quantization: string | null;
  label: string | null;
  yes: boolean;
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
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lane" || args[i] === "--provider" || args[i] === "-p") {
      flagLane = args[++i] ?? null;
    } else if (args[i] === "--quant" || args[i] === "--quantization" || args[i] === "-q") {
      quantization = args[++i] ?? null;
    } else if (args[i] === "--label" || args[i] === "--name") {
      label = args[++i] ?? null;
    } else if (args[i] === "--yes" || args[i] === "-y") {
      yes = true;
    } else {
      rest.push(args[i]!);
    }
  }

  const action = rest[0] === "pull" ? "pull" : rest[0] === "add" ? "add" : rest[0] === "remove" ? "remove" : rest[0] === "verify" ? "verify" : rest.length ? "set" : "show";
  const actionRest = action === "pull" || action === "add" || action === "remove" || action === "verify" ? rest.slice(1) : rest;
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
    yes,
  };
}

function readLaneFlag(args: string[]): string | null {
  const index = args.indexOf("--lane");
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readProviderFlag(args: string[]): string | null {
  const index = args.findIndex((a) => a === "--provider" || a === "--p");
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
    value === "ollama" ||
    value === "ollama-cloud" ||
    value === "ollama_cloud" ||
    value === "openrouter" ||
    value === "open-router" ||
    value === "or" ||
    value === "huggingface" ||
    value === "hugging-face" ||
    value === "hf" ||
    value === "hf-cloud" ||
    value === "hf.co" ||
    value === "openai" ||
    value === "open-ai" ||
    value === "gpt" ||
    value === "anthropic" ||
    value === "claude" ||
    value === "google" ||
    value === "gemini" ||
    value === "llama-cpp" ||
    value === "llama_cpp" ||
    value === "llamacpp" ||
    value === "llama" ||
    value === "llama-server" ||
    value === "mlx" ||
    value === "mlx-lm" ||
    value === "mlxlm" ||
    value === "apple-mlx" ||
    value === "litert" ||
    value === "litert-lm" ||
    value === "edge" ||
    value === "google-edge";
}
