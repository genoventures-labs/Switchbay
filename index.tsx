import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { createRuntimeClient } from "./src/runtime/client";
import { getToolMode, normalizeRuntimeLane } from "./src/config/env";
import { SwitchbayApp } from "./src/tui/app";
import { loadSwitchbayConfig } from "./src/config/switchbay-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions, loadPersistedSession, savePersistedSession } from "./src/session/persistence";
import { buildTurn, executeTurn, extractAssistantText, refreshWorkspace, synthesizeAssistantFallback } from "./src/agent/loop";
import { describeEngineBay, loadEngineBayInventory, syncEngineBayRepo } from "./src/engines/hub";
import { describeToolbox, loadToolboxInventory, readToolboxSkill } from "./src/toolbox/hub";
import { describeMemory, listMemoryNotes, readMemoryFacts, refreshMemory } from "./src/memory/store";
import { createDefaultLmStudioMcpConfig, describeLmStudioMcpConfig, loadLmStudioMcpConfig, saveLmStudioMcpConfig } from "./src/runtime/lmstudio-mcp-config";
import { describeTrustedMcpCatalog } from "./src/runtime/mcp-catalog";
import { ANSI_COLORS as CLR } from "./src/tui/theme";

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
  switchbay --resume                 Resume the last session
  switchbay --resume <id|index>      Resume a specific session by ID or index
  switchbay --new                    Start a fresh session
  switchbay --purge <duration>       Clean up old sessions (e.g. 1d, 1w)
  switchbay update                   Print update instructions
  switchbay version                  Print version
  switchbay engines                  Show Engine Bay cache status
  switchbay engines sync             Pull the Switchbay-Engines GitHub repo
  switchbay engines list             List cached engine files and manifests
  switchbay engines templates        List cached templates
  switchbay toolbox                  Show Toolbox cache and skill status
  switchbay toolbox sync             Pull the Engine-Toolboxes GitHub repo
  switchbay toolbox list             List available skills
  switchbay toolbox templates        List cached skill templates
  switchbay toolbox read <id>        Print a skill
  switchbay memory                   Show workspace memory status
  switchbay memory refresh           Refresh operational memory
  switchbay memory list              List memory notes
  switchbay memory facts             List structured memory facts
  switchbay mcp                      Show LM Studio MCP lane config
  switchbay mcp init                 Create .switchbay/lmstudio.mcp.json
  switchbay mcp catalog              List trusted MCP config options

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

  if (options.subcommand === "toolbox") {
    await runToolboxCommand(options.toolboxAction, options.toolboxSkill);
    return;
  }

  if (options.subcommand === "memory") {
    await runMemoryCommand(options.memoryAction);
    return;
  }

  if (options.subcommand === "mcp") {
    await runMcpCommand(options.mcpAction);
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

  // CLI Mode: One-shot query provided
  if (options.initialQuery) {
    await runCliMode(options, resumeId);
    process.exit(0);
  }

  // TUI Mode: No query, launch interactive app
  const lane = normalizeRuntimeLane(options.lane);
  const client = createRuntimeClient(lane);
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

async function runToolboxCommand(action: "status" | "sync" | "list" | "templates" | "read", skillId: string | null) {
  try {
    if (action === "sync") {
      console.log(await describeToolbox(true));
      return;
    }

    const inventory = await loadToolboxInventory();
    if (action === "templates") {
      console.log(inventory.templates.length ? inventory.templates.join("\n") : "No Toolbox templates found. Run `switchbay toolbox sync`.");
      return;
    }
    if (action === "list") {
      console.log(inventory.skills.length
        ? inventory.skills.map((skill) => `${skill.id} - ${skill.name}: ${skill.description}`).join("\n")
        : "No Toolbox skills found.");
      return;
    }
    if (action === "read") {
      if (!skillId) {
        console.error("switchbay toolbox: read requires a skill id.");
        process.exit(1);
      }
      const skill = await readToolboxSkill(skillId);
      if (!skill) {
        console.error(`switchbay toolbox: skill not found: ${skillId}`);
        process.exit(1);
      }
      console.log(skill.body);
      return;
    }
    console.log(await describeToolbox(false));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay toolbox: ${msg}`);
    process.exit(1);
  }
}

async function runMemoryCommand(action: "status" | "refresh" | "list" | "facts") {
  try {
    const cwd = process.cwd();
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

async function runCliMode(options: any, resumeId: string | null) {
  const runtimeLane = normalizeRuntimeLane(options.lane);
  const toolMode = getToolMode();
  const client = createRuntimeClient(runtimeLane);
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

boot().catch((err) => {
  console.error("switchbay: fatal boot error:", err);
  process.exit(1);
});
