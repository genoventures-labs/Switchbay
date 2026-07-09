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
import { describeEngineBay, loadEngineBayInventory, syncEngineBayRepo } from "./src/engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "./src/toolbox/hub";
import { addMemoryNote, describeMemory, listMemoryNotes, readMemoryFacts, refreshMemory } from "./src/memory/store";
import { describeKnowledgeIndex, formatKnowledgeSearchResults, refreshKnowledgeIndex, searchKnowledgeIndex } from "./src/knowledge/store";
import { describeLatestTrace, latestTraceExportPath, saveTraceRecord } from "./src/trace/store";
import { createDefaultLmStudioMcpConfig, describeLmStudioMcpConfig, loadLmStudioMcpConfig, saveLmStudioMcpConfig } from "./src/runtime/lmstudio-mcp-config";
import { describeTrustedMcpCatalog } from "./src/runtime/mcp-catalog";
import { ANSI_COLORS as CLR } from "./src/tui/theme";
import { describePlugins, loadPluginInventory, readPlugin } from "./src/plugins/registry";
import { listRuntimeModels, pullLmStudioModel, type RuntimeModelOption } from "./src/runtime/models";

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
  switchbay model pull <id|url>      Download, load, and pin an LM Studio model
  switchbay mcp                      Show Switchbay MCP bridge config
  switchbay mcp init                 Create ~/.switchbay/lmstudio.mcp.json
  switchbay mcp catalog              List trusted MCP config options

Context and memory:
  switchbay memory                   Show workspace memory status
  switchbay memory add <note>        Add a workspace memory note
  switchbay memory refresh           Refresh operational memory
  switchbay memory list              List memory notes
  switchbay memory facts             List structured memory facts
  switchbay knowledge                Show workspace knowledge index status
  switchbay knowledge refresh        Build/rebuild the local workspace knowledge map
  switchbay knowledge search <query> Search sourced workspace snippets
  switchbay trace                    Show latest turn trace
  switchbay trace export             Print latest trace file path

Extensions:
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

  if (options.subcommand === "memory") {
    await runMemoryCommand(options.memoryAction, options.memoryNote);
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

  if (options.subcommand === "mcp") {
    await runMcpCommand(options.mcpAction);
    return;
  }

  if (options.subcommand === "models") {
    await runModelsCommand(options.lane);
    return;
  }

  if (options.subcommand === "model") {
    await runModelCommand(options.lane, options.modelLane, options.modelTarget, options.modelAction ?? "show", options.modelQuantization ?? null);
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
  const selected = getSelectedRuntimeModel(lane);
  const client = createRuntimeClient(lane, selected ? { model: selected.id, provider: normalizeClientProvider(selected.provider) } : {});
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

async function runModelsCommand(rawLane: string | null) {
  const lane = normalizeRuntimeLane(rawLane);
  try {
    const selected = getSelectedRuntimeModel(lane);
    const result = await listRuntimeModels(lane);
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
  action: "show" | "set" | "pull",
  quantization: string | null,
) {
  const lane = normalizeRuntimeLane(rawModelLane ?? rawLane);
  if (action === "pull") {
    await runModelPullCommand(rawModelLane ?? rawLane, target, quantization);
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

async function runModelPullCommand(rawLane: string | null, target: string | null, quantization: string | null) {
  const lane = normalizeRuntimeLane(rawLane ?? "local");
  if (lane !== "local" && lane !== "local-mcp") {
    console.error("switchbay model pull: LM Studio pulls require the local lane. Use `switchbay model pull <model>` or `switchbay model pull local <model>`.");
    process.exit(1);
  }
  if (!target?.trim()) {
    console.error("switchbay model pull: requires a model catalog id or Hugging Face URL.");
    console.error("Example: switchbay model pull ibm/granite-4-micro");
    console.error("Example: switchbay model pull https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF --quant Q4_K_M");
    process.exit(1);
  }

  try {
    console.log(`Pulling ${target} through LM Studio...`);
    const result = await pullLmStudioModel({ model: target, quantization });
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model pull: ${msg}`);
    process.exit(1);
  }
}

async function runCliMode(options: any, resumeId: string | null) {
  const runtimeLane = normalizeRuntimeLane(options.lane);
  const toolMode = getToolMode();
  const selected = getSelectedRuntimeModel(runtimeLane);
  const client = createRuntimeClient(runtimeLane, selected ? { model: selected.id, provider: normalizeClientProvider(selected.provider) } : {});
  const workspace = await refreshWorkspace();
  
  let state = await loadPersistedSession(resumeId === "latest" ? undefined : resumeId || undefined);
  if (!state || options.newSession) {
    const { resolveAgentPolicy } = await import("./src/agent/policy");
    const { createInitialSessionState } = await import("./src/agent/turn-state");
    const policy = resolveAgentPolicy({ mode: options.mode, profile: options.profile });
    state = createInitialSessionState({
      mode: policy.mode,
      profile: options.profile,
      resolvedProfile: policy.runtimeProfile,
      surface: options.surface,
    });
  }

  const turn = await buildTurn({
    input: options.initialQuery,
    mode: state.mode,
    profile: state.requestedProfile,
    previousObjective: state.currentObjective,
    transcript: state.conversation,
    workspace,
    runtimeLane,
    toolMode,
  });

  process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset} ${CLR.muted}(thinking...)${CLR.reset}\n`);
  
  const onStep = (title: string) => {
    process.stdout.write(`  ${CLR.muted}└ ${title}${CLR.reset}\n`);
  };

  try {
    const executedTurn = await executeTurn({
      client,
      sessionId: state.sessionId,
      surface: state.surface,
      turn,
      workspace,
      onStep,
    });

    const content =
      extractAssistantText(executedTurn.response) ||
      synthesizeAssistantFallback(options.initialQuery, executedTurn.toolExecutions, workspace);
    if (content) {
      process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset}\n`);
      process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}${content}\n\n`);
      await saveTraceRecord({
        assistantContent: content,
        cwd: workspace?.cwd ?? process.cwd(),
        executedTurn,
        runtimeLane,
        toolMode,
        sessionId: state.sessionId,
        turn,
        userPrompt: options.initialQuery,
        workspace,
      });
      
      state.conversation.push({ role: "user", content: options.initialQuery });
      state.conversation.push({ role: "assistant", content });
      state.updatedAt = Date.now();
      await savePersistedSession(state);
    } else if (executedTurn.toolExecutions.length > 0) {
      process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset}\n`);
      process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}Turn completed after local tool work, but the model returned no final assistant text.\n\n`);
    } else {
      process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Switchbay${CLR.reset}\n`);
      process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}The model returned no assistant text for this turn.\n\n`);
    }
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

boot().catch((err) => {
  console.error("switchbay: fatal boot error:", err);
  process.exit(1);
});
