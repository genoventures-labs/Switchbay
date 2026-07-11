import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { createRuntimeClient, getRuntimeLaneLabel } from "./src/runtime/client";
import { getToolMode, normalizeRuntimeLane } from "./src/config/env";
import { SwitchbayApp } from "./src/tui/app";
import { getSelectedRuntimeModel, loadSwitchbayConfig, setSelectedRuntimeModel } from "./src/config/switchbay-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions, loadPersistedSession, savePersistedSession } from "./src/session/persistence";
import { buildTurn, executeTurn, extractAssistantText, refreshWorkspace, synthesizeAssistantFallback } from "./src/agent/loop";
import { tryLocalCommand } from "./src/agent/commands";
import { describeEngineBay, loadEngineBayInventory, syncEngineBayRepo } from "./src/engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "./src/toolbox/hub";
import { addMemoryNote, describeMemory, listMemoryNotes, readMemoryFacts, refreshMemory } from "./src/memory/store";
import { describeKnowledgeIndex, formatKnowledgeSearchResults, refreshKnowledgeIndex, searchKnowledgeIndex } from "./src/knowledge/store";
import { describeLatestTrace, latestTraceExportPath, saveTraceRecord } from "./src/trace/store";
import { createDefaultLmStudioMcpConfig, describeLmStudioMcpConfig, loadLmStudioMcpConfig, saveLmStudioMcpConfig } from "./src/runtime/lmstudio-mcp-config";
import { describeTrustedMcpCatalog } from "./src/runtime/mcp-catalog";
import { ANSI_COLORS as CLR } from "./src/tui/theme";
import { describePlugins, loadPluginInventory, readPlugin } from "./src/plugins/registry";
import { listRuntimeModels, normalizeLmStudioPullModel, pullLmStudioModel, type RuntimeModelOption } from "./src/runtime/models";
import { describeLocalProviders, getActiveLocalProvider, normalizeLocalProvider, setActiveLocalProvider, type LocalProviderId } from "./src/runtime/local-providers";
import { formatRouteTag } from "./src/runtime/route-display";
import { describeCloudProviders, normalizeCloudProvider, setActiveCloudProvider } from "./src/runtime/cloud-providers";
import { addDailyTask, clearDailyBoard, completeDailyTask, describeDailyBoard } from "./src/operator/daily-board";
import { formatFrictionRadar, runFrictionRadar } from "./src/operator/radar";
import { buildQuickHandoff } from "./src/operator/handoff";
import { getLmStudioNativeBase } from "./src/config/env";
import { addCloudModel, inferCloudModelProvider } from "./src/runtime/cloud-model-catalog";
import type { CloudProviderId } from "./src/runtime/cloud-providers";
import { findAgent, loadAllAgents, saveAgentDefinition, type AgentScope } from "./src/agent/agents";

// Ensure config is initialized on first boot
loadSwitchbayConfig();

const options = parseCliArgs(process.argv);

async function boot() {
  if (options.subcommand === "help") {
    console.log(`
Switchbay — terminal coding agent shell

Usage:
  switchbay                          Launch the TUI (interactive mode)
  switchbay "query"                  One-shot request
  switchbay serve                    Start the local HTTP API
  switchbay service install          Install the macOS login service
  switchbay service status           Show background service status
  switchbay service restart          Restart the background service
  switchbay service uninstall        Remove the background service
  switchbay "query" --hop <name>     Launch in a different workspace

Sessions:
  switchbay --resume                 Resume the last session
  switchbay --resume <id|index>      Resume a specific session by ID or index
  switchbay --new                    Start a fresh session
  switchbay --purge <duration>       Clean up old sessions (e.g. 1d, 1w)

Models and lanes:
  switchbay models                   List models for the active lane
  switchbay model                    Show the active lane model
  switchbay model <id>               Pin a model for the active lane
  switchbay model <lane> <id>        Pin a model for a specific lane
  switchbay model add openai <id>    Add a custom cloud model to the local catalog
  switchbay --lane cloud --add-model <id>
  switchbay model pull <id|url>      Pull/load a model through the active local provider
  switchbay cloud-provider           Show cloud provider/router config
  switchbay cloud-provider set <id>  Switch cloud provider: auto | openai | anthropic
  switchbay local-provider           Show local provider config
  switchbay local-provider set <id>  Switch local provider: lmstudio | ollama
  switchbay mcp                      Show Switchbay MCP bridge config
  switchbay mcp init                 Create ~/.switchbay/lmstudio.mcp.json
  switchbay mcp catalog              List trusted MCP config options

Context and memory:
  switchbay agenda                   Show today's Daily Board
  switchbay task add <text>          Add a Daily Board task
  switchbay task done <id>           Mark a Daily Board task done
  switchbay task clear               Clear today's Daily Board
  switchbay memory                   Show workspace memory status
  switchbay memory add <note>        Add a workspace memory note
  switchbay memory refresh           Refresh operational memory
  switchbay memory list              List memory notes
  switchbay memories list            Alias for memory notes
  switchbay memory facts             List structured memory facts
  switchbay knowledge                Show workspace knowledge index status
  switchbay knowledge refresh        Build/rebuild the local workspace knowledge map
  switchbay knowledge search <query> Search sourced workspace snippets
  switchbay trace                    Show latest turn trace
  switchbay trace export             Print latest trace file path
  switchbay radar                    Run read-only local friction checks
  switchbay handoff                  Print a compact next-session handoff

Extensions:
  switchbay agents                   Show available specialist agents
  switchbay agents list              List built-in, user, workspace, and plugin agents
  switchbay agents read <id>         Print an agent definition
  switchbay agent create --name <n> --specialty <role>
  switchbay agent create "Name" "Role or domain"
  switchbay engines                  Show Engine Bay cache status
  switchbay engines sync             Pull the Switchbay-Engines GitHub repo
  switchbay engines list             List cached engine files and manifests
  switchbay engines templates        List cached templates
  switchbay skills                   Show available Bay skills
  switchbay skills sync              Pull the GitHub-backed skills repo
  switchbay skills list              List available skills
  switchbay skills templates         List cached skill templates
  switchbay skills read <id>         Print a skill
  switchbay plugins                  Show workspace plugin status
  switchbay plugins list             List installed workspace plugins
  switchbay plugins inspect <id>     Print a plugin manifest and assets

Maintenance:
  switchbay update                   Print update instructions
  switchbay version                  Print version

Options:
  -s, --surface <type>   Surface context (default: dev)
  -p, --profile <name>   Working style (default: switchbay)
  -m, --mode <name>      Agent mode: build | design | debug (default: build)
  --lane <name>          Runtime lane: cloud | local | mcp (default: SWITCHBAY_LANE or cloud)
  --hop <name>           Travel to a whitelisted location before launching
  --resume <val>         Resume last saved session, or specific ID/Index (0=latest)
  --new                  Force a fresh session even if a saved one exists
  --purge <duration>     Purge sessions older than duration (1d, 5d, 2w, etc.)
`);
    return;
  }

  if (options.subcommand === "serve") {
    const { startApiServer } = await import("./src/api/server");
    const server = startApiServer();
    console.log(`Switchbay API listening on http://${server.hostname}:${server.port}`);
    return;
  }

  if (options.subcommand === "service") {
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand(options.serviceAction ?? "status"));
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
      const path = await saveLmStudioMcpConfig(createDefaultLmStudioMcpConfig(), cwd);
      console.log(`Created LM Studio MCP config at ${path}`);
      console.log("Edit it to match the MCP servers installed in LM Studio, then run `switchbay --lane mcp` or `/lane mcp`.");
      return;
    }
    if (action === "catalog") {
      console.log(`Trusted MCP Catalog\n\n${describeTrustedMcpCatalog()}`);
      return;
    }

    console.log(describeLmStudioMcpConfig(await loadLmStudioMcpConfig(cwd)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay mcp: ${msg}`);
    process.exit(1);
  }
}

async function runLocalProviderCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const provider = normalizeLocalProvider(target);
    if (!provider) {
      console.error("switchbay local-provider: set requires `lmstudio` or `ollama`.");
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
    const rows = result.models.map((model) => formatModelRow(model, selected?.id === model.id));
    console.log(`${getRuntimeLaneLabel(lane)} models`);
    console.log(rows.length ? rows.join("\n") : "No models found.");
    if (selected && !result.models.some((model) => model.id === selected.id)) {
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
  const lane = normalizeRuntimeLane(rawLane ?? "local");
  const localProvider = normalizeLocalProvider(rawLane) ?? getActiveLocalProvider();
  if (lane !== "local" && lane !== "local-mcp") {
    console.error("switchbay model pull: local pulls require the local lane. Use `switchbay model pull <model>` or `switchbay model pull local <model>`.");
    process.exit(1);
  }
  if (!target?.trim()) {
    console.error("switchbay model pull: requires a model catalog id or Hugging Face URL.");
    console.error("Example: switchbay model pull ibm/granite-4-micro");
    console.error("Example: switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M");
    process.exit(1);
  }

  try {
    if (localProvider === "ollama") {
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
      return;
    }
    console.log(`Pulling ${target} through LM Studio...`);
    console.log(`LM Studio native API: ${getLmStudioNativeBase()}`);
    try {
      const result = await pullLmStudioModel({ model: target, quantization });
      if (result.requestedModel !== result.model) {
        console.log(`Normalized target: ${result.model}`);
      }
      setSelectedRuntimeModel(lane, {
        id: result.instanceId ?? result.model,
        provider: lane === "local-mcp" ? "lmstudio-mcp" : "lmstudio",
      });
      console.log(`Downloaded: ${result.downloadStatus}${result.jobId ? ` (${result.jobId})` : ""}`);
      console.log(`Loaded: ${result.loadStatus}${result.instanceId ? ` as ${result.instanceId}` : ""}`);
      if (result.loadTimeSeconds !== undefined) {
        console.log(`Load time: ${result.loadTimeSeconds}s`);
      }
      console.log(`Selected ${result.instanceId ?? result.model} for ${getRuntimeLaneLabel(lane)}.`);
    } catch (error: any) {
      if (!isLmStudioPullFallbackCandidate(error.message)) throw error;
      const model = normalizeLmStudioPullModel(target);
      console.error(error.message);
      console.log("");
      console.log("Trying LM Studio CLI fallback: `lms get`.");
      console.log("This may prompt for download confirmation.");
      await runLmStudioCliFallback(model, lane);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model pull: ${msg}`);
    process.exit(1);
  }
}

function isLmStudioPullFallbackCandidate(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("unable to connect") ||
    lower.includes("network/catalog download failure") ||
    lower.includes("model is not in lm studio's catalog");
}

async function runLmStudioCliFallback(model: string, lane: ReturnType<typeof normalizeRuntimeLane>) {
  if (!model) throw new Error("LM Studio CLI fallback needs a model id.");

  await runInheritedCommand(["lms", "get", model]);

  const host = lmStudioHostArg();
  const loadCommand = host ? ["lms", "load", model, "--host", host] : ["lms", "load", model];
  try {
    await runInheritedCommand(loadCommand);
  } catch (error: any) {
    console.log("");
    console.log(`Downloaded with lms, but automatic load did not complete: ${error.message}`);
    console.log(`Try manually: ${loadCommand.map(shellQuote).join(" ")}`);
  }

  setSelectedRuntimeModel(lane, {
    id: model,
    provider: lane === "local-mcp" ? "lmstudio-mcp" : "lmstudio",
  });
  console.log(`Selected ${model} for ${getRuntimeLaneLabel(lane)}.`);
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

async function runInheritedCommand(command: string[]): Promise<void> {
  try {
    const proc = Bun.spawn(command, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`${command.map(shellQuote).join(" ")} exited with ${exitCode}`);
    }
  } catch (error: any) {
    if (error?.code === "ENOENT" || /ENOENT|not found/i.test(error.message)) {
      throw new Error("LM Studio CLI `lms` was not found. Open LM Studio once, then run `lms --help` to confirm it is installed.");
    }
    throw error;
  }
}

function lmStudioHostArg(): string | null {
  try {
    const url = new URL(getLmStudioNativeBase());
    return url.host;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

async function runCliMode(options: any, resumeId: string | null) {
  const { runSwitchbayTurn } = await import("./src/api/service");
  let sessionId = resumeId;
  if (resumeId === "latest") sessionId = (await listSessions())[0]?.id ?? null;
  process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset} ${CLR.muted}(thinking...)${CLR.reset}\n`);
  try {
    const result = await runSwitchbayTurn({
      input: options.initialQuery,
      lane: options.lane,
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
    process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset}\n`);
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
  return provider === "openai" || provider === "anthropic" ? provider : null;
}

function normalizeClientCloudProvider(provider: ReturnType<typeof normalizeCloudProvider>) {
  return provider === "openai" || provider === "anthropic" ? provider : null;
}

boot().catch((err) => {
  console.error("switchbay: fatal boot error:", err);
  process.exit(1);
});
