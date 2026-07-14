import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { createRuntimeClient, getRuntimeLaneLabel } from "./src/runtime/client";
import { getToolMode, normalizeRuntimeLane } from "./src/config/env";
import { SwitchbayApp } from "./src/tui/app";
import { clearSelectedRuntimeModel, getSelectedRuntimeModel, loadSwitchbayConfig, setSelectedRuntimeModel } from "./src/config/switchbay-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions, loadPersistedSession, savePersistedSession } from "./src/session/persistence";
import { buildTurn, executeTurn, extractAssistantText, refreshWorkspace, synthesizeAssistantFallback } from "./src/agent/loop";
import { tryLocalCommand } from "./src/agent/commands";
import { describeEngineBay, loadEngineBayInventory, syncEngineBayRepo } from "./src/engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "./src/toolbox/hub";
import { addMemoryNote, describeMemory, listMemoryNotes, readMemoryFacts, refreshMemory } from "./src/memory/store";
import { describeKnowledgeIndex, formatKnowledgeSearchResults, refreshKnowledgeIndex, searchKnowledgeIndex } from "./src/knowledge/store";
import { describeLatestTrace, latestTraceExportPath, saveTraceRecord } from "./src/trace/store";
import { loadLatestTrace } from "./src/trace/store";
import { formatTraceGraph, formatUsage, listTraceRecords } from "./src/telemetry/usage";
import { createDefaultSwitchbayMcpConfig, describeSwitchbayMcpConfig, loadSwitchbayMcpConfig, saveSwitchbayMcpConfig } from "./src/runtime/mcp-config";
import { describeTrustedMcpCatalog } from "./src/runtime/mcp-catalog";
import { ANSI_COLORS as CLR } from "./src/tui/theme";
import { describePlugins, loadPluginInventory, readPlugin } from "./src/plugins/registry";
import { listRuntimeModels, type RuntimeModelOption } from "./src/runtime/models";
import { describeLocalProviders, getActiveLocalProvider, normalizeLocalProvider, setActiveLocalProvider, type LocalProviderId } from "./src/runtime/local-providers";
import { formatRouteTag } from "./src/runtime/route-display";
import { describeAutoModelPool, describeCloudProviders, getActiveCloudProvider, normalizeCloudProvider, setActiveCloudProvider } from "./src/runtime/cloud-providers";
import { addDailyTask, clearDailyBoard, completeDailyTask, describeDailyBoard } from "./src/operator/daily-board";
import { formatFrictionRadar, runFrictionRadar } from "./src/operator/radar";
import { buildQuickHandoff } from "./src/operator/handoff";
import { addCloudModel, inferCloudModelProvider } from "./src/runtime/cloud-model-catalog";
import type { CloudProviderId } from "./src/runtime/cloud-providers";
import { findAgent, loadAllAgents, saveAgentDefinition, type AgentScope } from "./src/agent/agents";

// Ensure config is initialized on first boot
loadSwitchbayConfig();

const options = parseCliArgs(process.argv);

async function boot() {
  if (options.subcommand === "help") {
    console.log(`
${CLR.accentBright}${CLR.bold}Switchbay${CLR.reset} — terminal coding agent shell

${CLR.accent}${CLR.bold}Usage:${CLR.reset}
  ${CLR.bold}switchbay${CLR.reset}                          Launch the TUI (interactive mode)
  ${CLR.bold}switchbay${CLR.reset} "${CLR.accentBright}query${CLR.reset}"                  One-shot request
  ${CLR.bold}switchbay serve${CLR.reset}                    Start the local HTTP API
  ${CLR.bold}switchbay service install${CLR.reset}          Install the macOS login service
  ${CLR.bold}switchbay service status${CLR.reset}           Show background service status
  ${CLR.bold}switchbay service restart${CLR.reset}          Restart the background service
  ${CLR.bold}switchbay service uninstall${CLR.reset}        Remove the background service
  ${CLR.bold}switchbay update${CLR.reset}                     Update Switchbay (git/homebrew & restart service)
  ${CLR.bold}switchbay${CLR.reset} "${CLR.accentBright}query${CLR.reset}" ${CLR.accent}--hop${CLR.reset} <name>     Launch in a different workspace

${CLR.accent}${CLR.bold}Sessions:${CLR.reset}
  ${CLR.bold}switchbay --resume${CLR.reset}                 Resume the last session
  ${CLR.bold}switchbay --resume${CLR.reset} <id|index>      Resume a specific session by ID or index
  ${CLR.bold}switchbay --new${CLR.reset}                    Start a fresh session
  ${CLR.bold}switchbay --purge${CLR.reset} <duration>       Clean up old sessions (e.g. 1d, 1w)

${CLR.accent}${CLR.bold}Models and Lanes:${CLR.reset}
  ${CLR.bold}switchbay models${CLR.reset}                   List models for the active lane
  ${CLR.bold}switchbay model${CLR.reset}                    Show the active lane model
  ${CLR.bold}switchbay model${CLR.reset} <id>               Pin a model for the active lane
  ${CLR.bold}switchbay model${CLR.reset} <lane> <id>        Pin a model for a specific lane
  ${CLR.bold}switchbay model add openai${CLR.reset} <id>    Add a custom cloud model to the local catalog
  ${CLR.bold}switchbay --lane cloud --add-model${CLR.reset} <id>
  ${CLR.bold}switchbay model pull${CLR.reset} <id|url>      Pull/load a model through the active local provider
  ${CLR.bold}switchbay cloud-provider${CLR.reset}           Show cloud provider/router config
  ${CLR.bold}switchbay cloud-provider set${CLR.reset} <id>  Switch cloud provider: ${CLR.accentBright}auto | openai | anthropic | gemini${CLR.reset}
  ${CLR.bold}switchbay local-provider${CLR.reset}           Show local provider config
  ${CLR.bold}switchbay local-provider set${CLR.reset} <id>  Switch local provider: ${CLR.accentBright}ollama${CLR.reset}
  ${CLR.bold}switchbay mcp${CLR.reset}                      Show Switchbay MCP bridge config
  ${CLR.bold}switchbay mcp init${CLR.reset}                 Create default Switchbay MCP config
  ${CLR.bold}switchbay mcp catalog${CLR.reset}              List trusted MCP config options

${CLR.accent}${CLR.bold}Context and Memory:${CLR.reset}
  ${CLR.bold}switchbay agenda${CLR.reset}                   Show today's Daily Board
  ${CLR.bold}switchbay task add${CLR.reset} <text>          Add a Daily Board task
  ${CLR.bold}switchbay task done${CLR.reset} <id>           Mark a Daily Board task done
  ${CLR.bold}switchbay task clear${CLR.reset}               Clear today's Daily Board
  ${CLR.bold}switchbay memory${CLR.reset}                   Show workspace memory status
  ${CLR.bold}switchbay memory add${CLR.reset} <note>        Add a workspace memory note
  ${CLR.bold}switchbay memory refresh${CLR.reset}           Refresh operational memory
  ${CLR.bold}switchbay memory list${CLR.reset}              List memory notes
  ${CLR.bold}switchbay memories list${CLR.reset}            Alias for memory notes
  ${CLR.bold}switchbay memory facts${CLR.reset}             List structured memory facts
  ${CLR.bold}switchbay knowledge${CLR.reset}                Show workspace knowledge index status
  ${CLR.bold}switchbay knowledge refresh${CLR.reset}        Build/rebuild the local workspace knowledge map
  ${CLR.bold}switchbay knowledge search${CLR.reset} <query> Search sourced workspace snippets
  ${CLR.bold}switchbay trace${CLR.reset}                    Show latest turn trace
  ${CLR.bold}switchbay trace export${CLR.reset}             Print latest trace file path
  ${CLR.bold}switchbay usage${CLR.reset}                    Graph traced turns, routes, tokens, and tools
  ${CLR.bold}switchbay graph trace${CLR.reset}               Graph the latest agent turn flow
  ${CLR.bold}switchbay radar${CLR.reset}                    Run read-only local friction checks
  ${CLR.bold}switchbay handoff${CLR.reset}                  Print a compact next-session handoff

${CLR.accent}${CLR.bold}Extensions:${CLR.reset}
  ${CLR.bold}switchbay agents${CLR.reset}                   Show available specialist agents
  ${CLR.bold}switchbay agents list${CLR.reset}              List built-in, user, workspace, and plugin agents
  ${CLR.bold}switchbay agents read${CLR.reset} <id>         Print an agent definition
  ${CLR.bold}switchbay agent create --name${CLR.reset} <n> ${CLR.accent}--specialty${CLR.reset} <role>
  ${CLR.bold}switchbay agent create${CLR.reset} "Name" "Role or domain"
  ${CLR.bold}switchbay engines${CLR.reset}                  Show Engine Bay cache status
  ${CLR.bold}switchbay engines sync${CLR.reset}             Pull the Switchbay-Engines GitHub repo
  ${CLR.bold}switchbay engines list${CLR.reset}             List cached engine files and manifests
  ${CLR.bold}switchbay engines templates${CLR.reset}        List cached templates
  ${CLR.bold}switchbay skills${CLR.reset}                   Show available Bay skills
  ${CLR.bold}switchbay skills sync${CLR.reset}              Pull the GitHub-backed skills repo
  ${CLR.bold}switchbay skills list${CLR.reset}              List available skills
  ${CLR.bold}switchbay skills templates${CLR.reset}         List cached skill templates
  ${CLR.bold}switchbay skills read${CLR.reset} <id>         Print a skill
  ${CLR.bold}switchbay plugins${CLR.reset}                  Show workspace plugin status
  ${CLR.bold}switchbay plugins list${CLR.reset}             List installed workspace plugins
  ${CLR.bold}switchbay plugins inspect${CLR.reset} <id>     Print a plugin manifest and assets

${CLR.accent}${CLR.bold}Maintenance:${CLR.reset}
  ${CLR.bold}switchbay update${CLR.reset}                   Print update instructions
  ${CLR.bold}switchbay version${CLR.reset}                  Print version

${CLR.accent}${CLR.bold}Options:${CLR.reset}
  ${CLR.bold}-s, --surface${CLR.reset} <type>   Surface context (default: dev)
  ${CLR.bold}-p, --profile${CLR.reset} <name>   Working style (default: switchbay)
  ${CLR.bold}-m, --mode${CLR.reset} <name>      Agent mode: ${CLR.accentBright}build | design | debug${CLR.reset} (default: build)
  ${CLR.bold}--lane${CLR.reset} <name>          Runtime lane: ${CLR.accentBright}cloud | local | huggingface | openrouter | ollama-cloud | mcp${CLR.reset}
  ${CLR.bold}--vision${CLR.reset} <path|url>     Attach an image and pin this turn to OpenAI vision
  ${CLR.bold}--hop${CLR.reset} <name>           Travel to a whitelisted location before launching
  ${CLR.bold}--resume${CLR.reset} <val>         Resume last saved session, or specific ID/Index (0=latest)
  ${CLR.bold}--new${CLR.reset}                  Force a fresh session even if a saved one exists
  ${CLR.bold}--purge${CLR.reset} <duration>     Purge sessions older than duration (1d, 5d, 2w, etc.)
  ${CLR.bold}-d, --detach${CLR.reset}               Run the API server in the background (detached mode)
`);
    return;
  }

  if (options.subcommand === "serve") {
    const port = Number(Bun.env.SWITCHBAY_API_PORT ?? 7349);
    const host = Bun.env.SWITCHBAY_API_HOST ?? "127.0.0.1";

    // Fast port check in foreground
    try {
      const net = require("node:net");
      await new Promise<void>((resolve, reject) => {
        const testServer = net.createServer();
        testServer.once("error", reject);
        testServer.once("listening", () => {
          testServer.close();
          resolve();
        });
        testServer.listen(port, host);
      });
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.error(`\n${CLR.error}Error: Port is already in use.${CLR.reset}`);
        console.error("The Switchbay background service or another instance is likely already running.");
        console.error("You can:");
        console.error("  1. Check service status:   switchbay service status");
        console.error("  2. Uninstall the service:  switchbay service uninstall");
        console.error("  3. Run on another port:    SWITCHBAY_API_PORT=7350 switchbay serve\n");
        process.exit(1);
      }
    }

    if (options.detach) {
      const bin = process.argv[0];
      const script = process.argv[1];
      const spawnArgs = [bin, script, "serve"];
      if (options.surface !== DEFAULTS.surface) spawnArgs.push("--surface", options.surface);
      if (options.profile !== DEFAULTS.profile) spawnArgs.push("--profile", options.profile);
      if (options.mode !== DEFAULTS.mode) spawnArgs.push("--mode", options.mode);
      if (options.lane) spawnArgs.push("--lane", options.lane);

      const child = Bun.spawn(spawnArgs, {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      child.unref();

      console.log(`\n${CLR.accent}⏺${CLR.reset} Switchbay API server started in background (detached).`);
      console.log(`URL: http://${host}:${port}\n`);
      return;
    }

    const { startApiServer } = await import("./src/api/server");
    try {
      const server = startApiServer();
      console.log(`Switchbay API listening on http://${server.hostname}:${server.port}`);
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" || err?.message?.includes("EADDRINUSE")) {
        console.error(`\n${CLR.error}Error: Port is already in use.${CLR.reset}`);
        console.error("The Switchbay background service or another instance is likely already running.");
        console.error("You can:");
        console.error("  1. Check service status:   switchbay service status");
        console.error("  2. Uninstall the service:  switchbay service uninstall");
        console.error("  3. Run on another port:    SWITCHBAY_API_PORT=7350 switchbay serve\n");
        process.exit(1);
      }
      throw err;
    }
    return;
  }

  if (options.subcommand === "service") {
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand(options.serviceAction ?? "status"));
    return;
  }

  if (options.subcommand === "update") {
    await runUpdateCommand();
    return;
  }

  if (options.subcommand === "engines") {
    await runEngineCommand(options.engineAction);
    return;
  }

  if (options.subcommand === "skills" || options.subcommand === "toolbox") {
    await runToolboxCommand(options.toolboxAction, options.toolboxSkill, options.subcommand);
    return;
  }

  if (options.subcommand === "plugins") {
    await runPluginCommand(options.pluginAction ?? "status", options.pluginId ?? null);
    return;
  }

  if (options.subcommand === "agents") {
    await runAgentsCommand(
      options.agentAction ?? "status",
      options.agentId ?? null,
      {
        name: options.agentName ?? null,
        specialty: options.agentSpecialty ?? null,
        approach: options.agentApproach ?? null,
        rules: options.agentRules ?? null,
        scope: options.agentScope ?? "workspace",
      },
    );
    return;
  }

  if (options.subcommand === "memory") {
    await runMemoryCommand(options.memoryAction, options.memoryNote);
    return;
  }

  if (options.subcommand === "agenda") {
    console.log(describeDailyBoard());
    return;
  }

  if (options.subcommand === "task") {
    await runTaskCommand(options.taskAction ?? "status", options.taskText ?? null, options.taskId ?? null);
    return;
  }

  if (options.subcommand === "knowledge") {
    await runKnowledgeCommand(options.knowledgeAction, options.knowledgeQuery);
    return;
  }

  if (options.subcommand === "trace") {
    await runTraceCommand(options.traceAction);
    return;
  }

  if (options.subcommand === "usage") {
    console.log(formatUsage(await listTraceRecords(process.cwd())));
    return;
  }

  if (options.subcommand === "graph") {
    console.log(formatTraceGraph((await loadLatestTrace(process.cwd()))?.record ?? null));
    return;
  }

  if (options.subcommand === "radar") {
    await runRadarCommand(options.lane);
    return;
  }

  if (options.subcommand === "handoff") {
    await runHandoffCommand();
    return;
  }

  if (options.subcommand === "mcp") {
    await runMcpCommand(options.mcpAction);
    return;
  }

  if (options.subcommand === "models") {
    await runModelsCommand(options.lane);
    return;
  }

  if (options.subcommand === "model") {
    await runModelCommand(options.lane, options.modelLane, options.modelTarget, options.modelAction ?? "show", options.modelQuantization ?? null, options.modelLabel ?? null);
    return;
  }

  if (options.subcommand === "local-provider") {
    await runLocalProviderCommand(options.localProviderAction ?? "status", options.localProviderTarget ?? null);
    return;
  }

  if (options.subcommand === "cloud-provider") {
    await runCloudProviderCommand(options.cloudProviderAction ?? "status", options.cloudProviderTarget ?? null);
    return;
  }

  if (options.subcommand !== "run") return;

  if (options.purge) {
    const duration = options.purge.toLowerCase();
    let ms = 0;
    const match = duration.match(/^(\d+)([dw])$/);
    if (match?.[1] && match[2]) {
      const count = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === "d") ms = count * 24 * 60 * 60 * 1000;
      else if (unit === "w") ms = count * 7 * 24 * 60 * 60 * 1000;
    } else {
      console.error(`switchbay: invalid purge duration "${options.purge}". Use e.g. 1d, 5d, 2w.`);
      process.exit(1);
    }
    
    const count = await purgeSessions(ms);
    console.log(`switchbay: purged ${count} old session(s).`);
    if (!options.resume && !options.initialQuery) {
        process.exit(0);
    }
  }

  let resumeId: string | null = null;
  if (options.resume && !options.newSession) {
    if (typeof options.resume === "string") {
      if (/^\d+$/.test(options.resume)) {
        const sessions = await listSessions();
        const index = parseInt(options.resume, 10);
        if (sessions[index]) {
          resumeId = sessions[index].id;
        } else {
          console.error(`switchbay: session index ${index} not found. Use /sessions to see history.`);
          process.exit(1);
        }
      } else {
        resumeId = options.resume;
      }
    } else {
      resumeId = "latest";
    }
  }

  if (options.hop) {
    await applyInitialHop(options.hop);
  }

  // CLI Mode: One-shot query provided
  if (options.initialQuery) {
    await runCliMode(options, resumeId);
    process.exit(0);
  }

  // TUI Mode: No query, launch interactive app
  const lane = normalizeRuntimeLane(options.lane);
  const localProvider = normalizeLocalProvider(options.lane);
  const cloudProvider = normalizeCloudProvider(options.lane);
  const selected = getSelectedRuntimeModel(lane);
  const client = createRuntimeClient(lane, selected
    ? { model: selected.id, provider: normalizeClientProvider(selected.provider) ?? normalizeClientCloudProvider(cloudProvider), localProvider }
    : { localProvider, provider: normalizeClientCloudProvider(cloudProvider) });
  render(
    <SwitchbayApp
      client={client}
      lane={lane}
      initialHopLabel={null}
      initialQuery=""
      mode={options.mode}
      profile={options.profile}
      surface={options.surface}
      resumeId={resumeId}
    />,
  );
}

async function applyInitialHop(query: string) {
  const matches = await fuzzyMatchLocations(query);
  if (!matches.length) {
    console.error(`switchbay: no workspace matched "${query}". Use /workspace add <path> or enable auto_discover.`);
    process.exit(1);
  }

  const target = matches[0]!;
  const result = await travelTo(target.absPath);
  if (!result.ok) {
    console.error(`switchbay: hop failed: ${result.error}`);
    process.exit(1);
  }
}

async function runEngineCommand(action: "status" | "sync" | "list" | "templates") {
  try {
    if (action === "sync") {
      console.log(await describeEngineBay(true));
      return;
    }

    const inventory = await loadEngineBayInventory();
    if (action === "templates") {
      console.log(inventory.templates.length ? inventory.templates.join("\n") : "No Engine Bay templates found. Run `switchbay engines sync`.");
      return;
    }
    if (action === "list") {
      const items = [...inventory.manifests, ...inventory.engineFiles];
      console.log(items.length ? items.join("\n") : "No Engine Bay files found. Run `switchbay engines sync`.");
      return;
    }
    console.log(await describeEngineBay(false));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay engines: ${msg}`);
    process.exit(1);
  }
}

async function runToolboxCommand(
  action: "status" | "sync" | "list" | "templates" | "read",
  skillId: string | null,
  commandName: "skills" | "toolbox" = "skills",
) {
  const command = `switchbay ${commandName}`;
  try {
    if (action === "sync") {
      console.log(await describeToolbox(true));
      return;
    }

    const inventory = await loadToolboxInventory();
    if (action === "templates") {
      console.log(inventory.templates.length ? inventory.templates.join("\n") : `No skill templates found. Run \`${command} sync\`.`);
      return;
    }
    if (action === "list") {
      console.log(inventory.skills.length
        ? inventory.skills.map((skill) => `${skill.id} - ${skill.name}: ${skill.description}`).join("\n")
        : "No skills found.");
      return;
    }
    if (action === "read") {
      if (!skillId) {
        console.error(`${command}: read requires a skill id.`);
        process.exit(1);
      }
      const skill = await readToolboxSkill(skillId);
      if (!skill) {
        console.error(`${command}: skill not found: ${skillId}`);
        process.exit(1);
      }
      console.log(skill.body);
      return;
    }
    console.log(await describeToolbox(false));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${command}: ${msg}`);
    process.exit(1);
  }
}

async function runPluginCommand(action: "status" | "list" | "inspect", pluginId: string | null) {
  try {
    if (action === "list") {
      const inventory = await loadPluginInventory();
      console.log(inventory.plugins.length
        ? inventory.plugins.map((plugin) => `${plugin.manifest.id} - ${plugin.manifest.name}: ${plugin.manifest.description}`).join("\n")
        : "No plugins installed. Create one with `/create-plugin` in the TUI.");
      return;
    }

    if (action === "inspect") {
      if (!pluginId) {
        console.error("switchbay plugins: inspect requires a plugin id.");
        process.exit(1);
      }
      const plugin = await readPlugin(pluginId);
      if (!plugin) {
        console.error(`switchbay plugins: plugin not found: ${pluginId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(plugin.manifest, null, 2));
      return;
    }

    console.log(await describePlugins());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay plugins: ${msg}`);
    process.exit(1);
  }
}

async function runAgentsCommand(
  action: "status" | "list" | "create" | "read",
  agentId: string | null,
  draft: {
    name: string | null;
    specialty: string | null;
    approach: string | null;
    rules: string | null;
    scope: AgentScope;
  },
) {
  try {
    const cwd = process.cwd();
    if (action === "create") {
      if (!draft.name?.trim() || !draft.specialty?.trim()) {
        console.error("switchbay agents create: requires a name and specialty.");
        console.error('Example: switchbay agent create --name "API Steward" --specialty "API design and integration checks"');
        console.error('Example: switchbay agent create "API Steward" "API design and integration checks" --rules "Never expose secrets."');
        process.exit(1);
      }

      const saved = await saveAgentDefinition({
        name: draft.name,
        specialty: draft.specialty,
        approach: draft.approach ?? undefined,
        rules: draft.rules ?? undefined,
        scope: draft.scope,
      }, cwd);
      console.log(`Created agent ${saved.id}.`);
      console.log(`Saved: ${saved.savePath}`);
      console.log(`Activate in the TUI with: /agent ${saved.id}`);
      return;
    }

    const agents = await loadAllAgents(cwd);
    if (action === "read") {
      if (!agentId) {
        console.error("switchbay agents read: requires an agent id.");
        process.exit(1);
      }
      const agent = findAgent(agentId, agents);
      if (!agent) {
        console.error(`switchbay agents: agent not found: ${agentId}`);
        process.exit(1);
      }
      if (agent.path) {
        const { readFile } = await import("node:fs/promises");
        console.log(await readFile(agent.path, "utf-8"));
        return;
      }
      console.log(`# ${agent.name}
id: ${agent.id}
emoji: ${agent.emoji}
description: ${agent.description}

${agent.prompt}
`);
      return;
    }

    const customCount = agents.filter((agent) => agent.custom).length;
    if (action === "list") {
      console.log(agents.map((agent) => `${agent.id} [${agent.source ?? "builtin"}] - ${agent.name}: ${agent.description}`).join("\n"));
      return;
    }

    console.log(`Agents: ${agents.length} available (${customCount} custom).`);
    console.log("List: switchbay agents list");
    console.log("Read: switchbay agents read <id>");
    console.log('Create: switchbay agent create --name "API Steward" --specialty "API design and integration checks"');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay agents: ${msg}`);
    process.exit(1);
  }
}

async function runMemoryCommand(action: "status" | "refresh" | "list" | "facts" | "add", note: string | null) {
  try {
    const cwd = process.cwd();
    if (action === "add") {
      if (!note?.trim()) {
        console.error('switchbay memory: add requires a note, e.g. `switchbay memory add "use Bun for tests"`.');
        process.exit(1);
      }
      const count = await addMemoryNote(cwd, note);
      console.log(`Remembered: ${note.trim()}`);
      console.log(`${count} note${count !== 1 ? "s" : ""} in memory.`);
      return;
    }
    if (action === "refresh") {
      console.log(await refreshMemory(cwd));
      return;
    }
    if (action === "list") {
      const notes = await listMemoryNotes(cwd);
      console.log(notes.length ? notes.map((note, index) => `${index}. ${note}`).join("\n") : "No memory notes.");
      return;
    }
    if (action === "facts") {
      const facts = await readMemoryFacts(cwd);
      console.log(facts.length ? facts.map((fact) => `${fact.key}: ${fact.value}`).join("\n") : "No memory facts. Run `switchbay memory refresh`.");
      return;
    }
    console.log(await describeMemory(cwd));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay memory: ${msg}`);
    process.exit(1);
  }
}

async function runTaskCommand(action: "status" | "add" | "done" | "clear", text: string | null, id: number | null) {
  try {
    if (action === "add") {
      if (!text?.trim()) {
        console.error("switchbay task add: requires task text.");
        process.exit(1);
      }
      const task = addDailyTask(text);
      console.log(`Added Daily Board task ${task.id}: ${task.text}`);
      console.log(`\n${describeDailyBoard()}`);
      return;
    }

    if (action === "done") {
      if (!id) {
        console.error("switchbay task done: requires a task id.");
        process.exit(1);
      }
      const task = completeDailyTask(id);
      if (!task) {
        console.error(`switchbay task done: task ${id} not found on today's board.`);
        process.exit(1);
      }
      console.log(`Completed Daily Board task ${task.id}: ${task.text}`);
      console.log(`\n${describeDailyBoard()}`);
      return;
    }

    if (action === "clear") {
      const count = clearDailyBoard();
      console.log(`Cleared ${count} Daily Board task${count === 1 ? "" : "s"}.`);
      return;
    }

    console.log(describeDailyBoard());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay task: ${msg}`);
    process.exit(1);
  }
}

async function runKnowledgeCommand(action: "status" | "refresh" | "search", query: string | null) {
  try {
    const cwd = process.cwd();
    if (action === "refresh") {
      const index = await refreshKnowledgeIndex(cwd);
      console.log(`Workspace knowledge refreshed.\nFiles: ${index.fileCount}\nChunks: ${index.chunkCount}`);
      return;
    }
    if (action === "search") {
      if (!query) {
        console.error("switchbay knowledge: search requires a query.");
        process.exit(1);
      }
      console.log(formatKnowledgeSearchResults(await searchKnowledgeIndex(query, cwd, 10)));
      return;
    }
    console.log(await describeKnowledgeIndex(cwd));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay knowledge: ${msg}`);
    process.exit(1);
  }
}

async function runTraceCommand(action: "last" | "export") {
  try {
    const cwd = process.cwd();
    if (action === "export") {
      const tracePath = await latestTraceExportPath(cwd);
      console.log(tracePath ?? "No trace exists yet. Complete a model turn first.");
      return;
    }
    console.log(await describeLatestTrace(cwd));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay trace: ${msg}`);
    process.exit(1);
  }
}

async function runRadarCommand(rawLane: string | null) {
  try {
    const lane = normalizeRuntimeLane(rawLane);
    const signals = await runFrictionRadar({
      cwd: process.cwd(),
      runtimeLane: lane,
      toolMode: getToolMode(),
    });
    console.log(formatFrictionRadar(signals));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay radar: ${msg}`);
    process.exit(1);
  }
}

async function runHandoffCommand() {
  try {
    console.log(await buildQuickHandoff({ cwd: process.cwd() }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay handoff: ${msg}`);
    process.exit(1);
  }
}

async function runMcpCommand(action: "status" | "init" | "catalog") {
  try {
    const cwd = process.cwd();
    if (action === "init") {
      const path = await saveSwitchbayMcpConfig(createDefaultSwitchbayMcpConfig(), cwd);
      console.log(`Created Switchbay MCP config at ${path}`);
      console.log("Edit it to match the MCP servers installed, then run `switchbay --lane cloud-mcp` or `/lane mcp`.");
      return;
    }
    if (action === "catalog") {
      console.log(`Trusted MCP Catalog\n\n${describeTrustedMcpCatalog()}`);
      return;
    }

    console.log(describeSwitchbayMcpConfig(await loadSwitchbayMcpConfig(cwd)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay mcp: ${msg}`);
    process.exit(1);
  }
}

async function runUpdateCommand() {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { writeFile, chmod } = await import("node:fs/promises");
  const { runCommand } = await import("./src/tools/shell");

  // Use import.meta.dir to find the actual repo root (where index.tsx lives),
  // not process.cwd() which is wherever the user ran `switchbay update` from.
  const repoDir = import.meta.dir;
  const isGit = existsSync(join(repoDir, ".git"));

  if (isGit) {
    console.log(`${CLR.accent}⏺${CLR.reset} ${CLR.bold}Switchbay Git Updater${CLR.reset}`);
    console.log("Updating from local git repository...");

    // 0. Check for uncommitted changes
    const gitStatus = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: repoDir });
    const hasUncommitted = gitStatus.stdout.toString().trim().length > 0;

    if (hasUncommitted) {
      console.log(`\n${CLR.accent}⚠${CLR.reset} ${CLR.bold}You have uncommitted local changes.${CLR.reset}`);
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const comment = await new Promise<string>((resolve) => {
        rl.question("Enter commit message for your changes (or press Enter to skip commit): ", resolve);
      });
      rl.close();

      if (comment.trim()) {
        console.log("Adding and committing changes...");
        const gitAdd = Bun.spawn(["git", "add", "."], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        await gitAdd.exited;

        const gitCommit = Bun.spawn(["git", "commit", "-m", comment.trim()], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        await gitCommit.exited;
      } else {
        console.log("Skipping commit. Proceeding with update...");
      }
    }

    // Check for unpushed commits
    const branchResult = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: repoDir });
    const branchName = branchResult.stdout.toString().trim();

    if (branchName) {
      const upstreamResult = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "@{u}"], { cwd: repoDir });
      const hasUpstream = upstreamResult.status === 0;

      let hasUnpushed = false;
      if (hasUpstream) {
        const unpushedResult = Bun.spawnSync(["git", "log", "@{u}..HEAD", "--oneline"], { cwd: repoDir });
        hasUnpushed = unpushedResult.stdout.toString().trim().length > 0;
      } else {
        hasUnpushed = true;
      }

      if (hasUnpushed) {
        console.log("Pushing local commits to remote...");
        const pushArgs = hasUpstream ? ["git", "push"] : ["git", "push", "-u", "origin", branchName];
        const gitPush = Bun.spawn(pushArgs, { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        const pushCode = await gitPush.exited;
        if (pushCode !== 0) {
          console.warn(`${CLR.error}Warning: git push failed. Proceeding with update...${CLR.reset}`);
        }
      }
    }

    // 1. git pull
    console.log("Running git pull...");
    const gitPull = Bun.spawn(["git", "pull"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const pullCode = await gitPull.exited;
    if (pullCode !== 0) {
      console.error(`${CLR.error}git pull failed with exit code ${pullCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 2. bun install
    console.log("Running bun install...");
    const bunInstall = Bun.spawn(["bun", "install"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const installCode = await bunInstall.exited;
    if (installCode !== 0) {
      console.error(`${CLR.error}bun install failed with exit code ${installCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 3. bun run build
    console.log("Building Switchbay...");
    const bunBuild = Bun.spawn(["bun", "run", "build"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const buildCode = await bunBuild.exited;
    if (buildCode !== 0) {
      console.error(`${CLR.error}bun run build failed with exit code ${buildCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 4. Update the service
    console.log("Reinstalling macOS service...");
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand("install"));

    // 5. Try linking the global CLI to this repository
    console.log("Updating global CLI command to point to this repository...");
    try {
      const activeCli = await runCommand(["which", "switchbay"]);
      if (activeCli.ok && activeCli.stdout?.trim()) {
        const cliPath = activeCli.stdout.trim();
        // Always point the shim at the repo's index.tsx, not wherever the user ran the command from
        const content = `#!/bin/bash\nexec bun "${join(repoDir, "index.tsx")}" "$@"\n`;
        await writeFile(cliPath, content);
        await chmod(cliPath, 0o755);
        console.log(`Linked global CLI command at ${cliPath} to ${join(repoDir, "index.tsx")}`);
      } else {
        console.log("No global `switchbay` command found in PATH to link.");
      }
    } catch (err: any) {
      console.log(`Note: Could not link global CLI path (run with sudo or check permissions if needed): ${err.message}`);
    }

    console.log(`\n${CLR.accent}⏺${CLR.reset} ${CLR.bold}Update successful!${CLR.reset}`);
    return;
  }

  // Not a git repo - update via Homebrew
  console.log(`${CLR.accent}⏺${CLR.reset} ${CLR.bold}Switchbay Homebrew Updater${CLR.reset}`);
  console.log("Checking for updates via Homebrew...");

  console.log("Running brew update...");
  const brewUpdate = Bun.spawn(["brew", "update"], { stdout: "inherit", stderr: "inherit" });
  const updateCode = await brewUpdate.exited;
  if (updateCode !== 0) {
    console.error(`${CLR.error}brew update failed with exit code ${updateCode}.${CLR.reset}`);
    process.exit(1);
  }

  console.log("Running brew upgrade switchbay...");
  const brewUpgrade = Bun.spawn(["brew", "upgrade", "switchbay"], { stdout: "inherit", stderr: "inherit" });
  const upgradeCode = await brewUpgrade.exited;
  if (upgradeCode !== 0) {
    console.log("brew upgrade finished or already up-to-date.");
  }

  // Restart/reinstall the daemon
  console.log("Rebuilding and restarting Switchbay macOS service...");
  try {
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand("install"));
  } catch (err: any) {
    console.error(`Failed to reinstall background service: ${err.message}`);
  }

  console.log(`\n${CLR.accent}⏺${CLR.reset} ${CLR.bold}Update completed!${CLR.reset}`);
}

async function runLocalProviderCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const provider = normalizeLocalProvider(target);
    if (!provider) {
      console.error("switchbay local-provider: set requires `ollama`.");
      process.exit(1);
    }
    setActiveLocalProvider(provider);
    console.log(`Local provider set to ${provider}.`);
    return;
  }
  console.log(describeLocalProviders());
}

async function runCloudProviderCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const provider = normalizeCloudProvider(target);
    if (!provider) {
      console.error("switchbay cloud-provider: set requires `auto`, `openai`, `anthropic`, or `google`.");
      process.exit(1);
    }
    setActiveCloudProvider(provider);
    console.log(`Cloud provider set to ${provider}.`);
    return;
  }
  console.log(describeCloudProviders());
}

async function runModelsCommand(rawLane: string | null) {
  const lane = normalizeRuntimeLane(rawLane);
  const localProvider = normalizeLocalProvider(rawLane) ?? undefined;
  try {
    const selected = getSelectedRuntimeModel(lane);
    const result = await listRuntimeModels(lane, localProvider);
    const requestedCloudProvider = normalizeCloudProvider(rawLane);
    const activeCloudProvider = requestedCloudProvider ?? getActiveCloudProvider();
    const visibleModels = lane === "cloud" && activeCloudProvider !== "auto"
      ? result.models.filter((model) => model.provider === activeCloudProvider)
      : result.models;
    const rows = visibleModels.map((model) => formatModelRow(model, selected?.id === model.id));
    console.log(`${getRuntimeLaneLabel(lane)} models${lane === "cloud" ? ` · mode=${activeCloudProvider}` : ""}`);
    if (lane === "cloud" && activeCloudProvider === "auto") console.log(`\n${describeAutoModelPool()}\n\nTrusted cloud catalog`);
    console.log(rows.length ? rows.join("\n") : "No models found.");
    if (selected && !visibleModels.some((model) => model.id === selected.id)) {
      console.log(`\nSelected: ${selected.id} (not returned by the current model list)`);
    }
    if (result.notice) console.log(`\n${result.notice}`);
    console.log(`\nSwitch with: switchbay model ${lane} <model-id>`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay models: ${msg}`);
    process.exit(1);
  }
}

async function runModelCommand(
  rawLane: string | null,
  rawModelLane: string | null,
  target: string | null,
  action: "show" | "set" | "pull" | "add",
  quantization: string | null,
  label: string | null,
) {
  const lane = normalizeRuntimeLane(rawModelLane ?? rawLane);
  if (action === "pull") {
    await runModelPullCommand(rawModelLane ?? rawLane, target, quantization);
    return;
  }

  if (action === "add") {
    await runModelAddCommand(rawModelLane ?? rawLane, target, label);
    return;
  }

  if (!target) {
    const selected = getSelectedRuntimeModel(lane);
    console.log(`${getRuntimeLaneLabel(lane)} model: ${selected?.id ?? "default"}`);
    console.log(`List options with: switchbay models --lane ${lane}`);
    console.log(`Switch with: switchbay model ${lane} <model-id>`);
    return;
  }

  try {
    const result = await listRuntimeModels(lane);
    const match = findRuntimeModel(result.models, target);
    if (!match) {
      console.error(`switchbay model: model not found on ${getRuntimeLaneLabel(lane)}: ${target}`);
      if (result.models.length) {
        console.error(`Available: ${result.models.map((model) => model.id).join(", ")}`);
      }
      if (result.notice) console.error(result.notice);
      process.exit(1);
    }

    if (match.provider === "auto") {
      clearSelectedRuntimeModel(lane);
      setActiveCloudProvider("auto");
      console.log(`Cleared the ${getRuntimeLaneLabel(lane)} model pin. Trusted auto-routing is active.`);
      return;
    }

    setSelectedRuntimeModel(lane, {
      id: match.id,
      provider: match.provider,
    });
    console.log(`Selected ${match.id} for ${getRuntimeLaneLabel(lane)}.`);
    console.log(`Stored in ~/.switchbay/config.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model: ${msg}`);
    process.exit(1);
  }
}

async function runModelAddCommand(rawLane: string | null, target: string | null, label: string | null) {
  const provider = normalizeCloudModelProvider(rawLane, target);
  const modelId = isCloudProviderAlias(target) ? null : target;
  if (!modelId?.trim()) {
    console.error("switchbay model add: requires a cloud model id.");
    console.error("Example: switchbay model add openai gpt-5.5");
    console.error("Example: switchbay --lane cloud --add-model gpt-5.5");
    process.exit(1);
  }

  try {
    const result = await addCloudModel({
      id: modelId,
      label,
      provider,
    });
    setSelectedRuntimeModel("cloud", {
      id: result.model.id,
      provider: result.model.provider,
    });
    console.log(`Added ${result.model.id} to cloud model catalog (${result.model.provider}).`);
    console.log(`Catalog: ~/.switchbay/cloud-models.json`);
    console.log(`Selected ${result.model.id} for Cloud.`);
    console.log(result.verified ? "OpenAI validation: ok" : result.notice ?? "Added without live validation.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model add: ${msg}`);
    process.exit(1);
  }
}

function normalizeCloudModelProvider(rawLane: string | null, target: string | null): CloudProviderId {
  const alias = rawLane?.toLowerCase();
  if (alias === "openai" || alias === "open-ai" || alias === "gpt") return "openai";
  if (alias === "anthropic" || alias === "claude") return "anthropic";
  if (alias === "google" || alias === "gemini") return "google";
  return inferCloudModelProvider(target ?? "");
}

function isCloudProviderAlias(value: string | null): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "openai" ||
    normalized === "open-ai" ||
    normalized === "gpt" ||
    normalized === "anthropic" ||
    normalized === "claude" ||
    normalized === "google" ||
    normalized === "gemini";
}

async function runModelPullCommand(rawLane: string | null, target: string | null, quantization: string | null) {
  const lane = "local";
  if (!target?.trim()) {
    console.error("switchbay model pull: requires a model catalog id or Hugging Face URL.");
    console.error("Example: switchbay model pull ibm/granite-4-micro");
    console.error("Example: switchbay model pull https://huggingface.co/bartowski/Llama-3-8B-Instruct-Gradient-1048k-GGUF --quant Q4_K_M");
    process.exit(1);
  }

  try {
    const { normalizeOllamaHuggingFaceModel, pullOllamaModel } = await import("./src/runtime/models");
    const targetModel = normalizeOllamaHuggingFaceModel(target, quantization);
    console.log(`Pulling ${targetModel} through Ollama...`);
    try {
      let lastPercent = -1;
      const result = await pullOllamaModel({
        model: targetModel,
        onProgress: (progress) => {
          if (progress.completed !== undefined && progress.total !== undefined && progress.total > 0) {
            const percent = Math.floor((progress.completed / progress.total) * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              process.stdout.write(`\rPulling... ${percent}% (${progress.status})`);
            }
          } else {
            process.stdout.write(`\rPulling... ${progress.status}`);
          }
        }
      });
      process.stdout.write("\n");
      setSelectedRuntimeModel("local", { id: result.model, provider: "ollama" });
      setActiveLocalProvider("ollama");
      console.log(`Pulled: ${result.status}`);
      console.log(`Selected ${result.model} for Ollama.`);
    } catch (error: any) {
      console.error(`Ollama pull API failed: ${error.message}`);
      console.log("");
      await runOllamaCliFallback(targetModel);
      setSelectedRuntimeModel("local", { id: targetModel, provider: "ollama" });
      setActiveLocalProvider("ollama");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model pull: ${msg}`);
    process.exit(1);
  }
}

async function runOllamaCliFallback(model: string) {
  if (!model) throw new Error("Ollama CLI fallback needs a model id.");
  console.log(`Trying Ollama CLI fallback: \`ollama pull ${model}\`.`);
  try {
    const proc = Bun.spawn(["ollama", "pull", model], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`ollama pull exited with ${exitCode}`);
    }
  } catch (error: any) {
    if (error?.code === "ENOENT" || /ENOENT|not found/i.test(error.message)) {
      throw new Error("Ollama CLI `ollama` was not found. Please make sure Ollama is installed and running.");
    }
    throw error;
  }
}



function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

async function runCliMode(options: any, resumeId: string | null) {
  const { runSwitchbayTurn } = await import("./src/api/service");
  const { modelSpeakerLabel, parseModelAddress } = await import("./src/runtime/model-identity");
  let sessionId = resumeId;
  if (resumeId === "latest") sessionId = (await listSessions())[0]?.id ?? null;
  const addressed = parseModelAddress(options.initialQuery);
  process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}${addressed?.speaker ?? "Auto"}${CLR.reset} ${CLR.muted}(thinking...)${CLR.reset}\n`);
  try {
    const result = await runSwitchbayTurn({
      input: options.visionPath ? `${options.initialQuery}\n\nImage: ${options.visionPath}` : options.initialQuery,
      lane: options.visionPath ? "openai" : options.lane,
      mode: options.mode,
      profile: options.profile,
      surface: options.surface,
      sessionId: sessionId ?? undefined,
      newSession: options.newSession,
      clientId: sessionId ? undefined : "cli",
      workspace: process.cwd(),
    }, {
      onStep: (title) => process.stdout.write(`  ${CLR.muted}└ ${title}${CLR.reset}\n`),
    });
    const speaker = modelSpeakerLabel(result.route);
    process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}${speaker}${CLR.reset}\n`);
    if (result.route?.using) process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}Using: ${result.route.using}\n`);
    process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}${result.content}\n\n`);
    if (result.pendingApproval) process.stdout.write(`  ${CLR.accentBright}Approval required:${CLR.reset} ${result.pendingApproval.summary}\n  Resume session ${result.sessionId} through the TUI or API to approve it.\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Error:${CLR.reset} ${msg}\n`);
  }
}

function findRuntimeModel(models: RuntimeModelOption[], target: string): RuntimeModelOption | null {
  const normalized = target.trim().toLowerCase();
  return models.find((model) => model.id.toLowerCase() === normalized) ??
    models.find((model) => model.label.toLowerCase() === normalized) ??
    null;
}

function formatModelRow(model: RuntimeModelOption, selected: boolean): string {
  const marker = selected ? "*" : " ";
  return `${marker} ${model.id} (${model.provider}, ${model.source})`;
}

function normalizeClientProvider(provider: string | undefined) {
  return provider === "openai" || provider === "anthropic" || provider === "google" ? provider : null;
}

function normalizeClientCloudProvider(provider: ReturnType<typeof normalizeCloudProvider>) {
  return provider === "openai" || provider === "anthropic" || provider === "google" ? provider : null;
}

boot().catch((err) => {
  console.error("switchbay: fatal boot error:", err);
  process.exit(1);
});
