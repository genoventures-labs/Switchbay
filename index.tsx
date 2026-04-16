import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { OriClient } from "./src/runtime/ori-client";
import { OriApp } from "./src/tui/app";
import { loadOriConfig } from "./src/config/ori-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions, loadPersistedSession, savePersistedSession } from "./src/session/persistence";
import { buildTurn, executeTurn, refreshWorkspace } from "./src/agent/loop";

// ANSI colors for CLI mode
const CLR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  salmon: "\x1b[38;2;229;115;115m",
  green: "\x1b[38;2;0;255;127m",
  gray: "\x1b[38;2;112;112;112m",
  white: "\x1b[37m",
};

// Ensure config is initialized on first boot
loadOriConfig();

const options = parseCliArgs(process.argv);

async function boot() {
  if (options.subcommand === "help") {
    console.log(`
ORI Code — terminal coding agent powered by ORI

Usage:
  ori-code                          Launch the TUI (interactive mode)
  ori-code "query"                  One-shot request
  ori-code "query" --hop <name>     Launch in a different workspace
  ori-code --resume                 Resume the last session
  ori-code --resume <id|index>      Resume a specific session by ID or index
  ori-code --new                    Start a fresh session
  ori-code --purge <duration>       Clean up old sessions (e.g. 1d, 1w)
  ori-code update                   Print update instructions
  ori-code version                  Print version

Options:
  -s, --surface <type>   Surface context (default: dev)
  -p, --profile <name>   Working style (default: ori_code)
  -m, --mode <name>      Agent mode: build | design | debug (default: build)
  --hop <name>           Travel to a whitelisted location before launching
  --resume <val>         Resume last saved session, or specific ID/Index (0=latest)
  --new                  Force a fresh session even if a saved one exists
  --purge <duration>     Purge sessions older than duration (1d, 5d, 2w, etc.)
`);
    return;
  }

  if (options.subcommand !== "run") return;

  if (options.purge) {
    const duration = options.purge.toLowerCase();
    let ms = 0;
    const match = duration.match(/^(\d+)([dw])$/);
    if (match) {
      const count = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === "d") ms = count * 24 * 60 * 60 * 1000;
      else if (unit === "w") ms = count * 7 * 24 * 60 * 60 * 1000;
    } else {
      console.error(`ori-code: invalid purge duration "${options.purge}". Use e.g. 1d, 5d, 2w.`);
      process.exit(1);
    }
    
    const count = await purgeSessions(ms);
    console.log(`ori-code: purged ${count} old session(s).`);
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
          console.error(`ori-code: session index ${index} not found. Use /sessions to see history.`);
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
    return;
  }

  // TUI Mode: No query, launch interactive app
  const client = new OriClient();
  render(
    <OriApp
      client={client}
      initialHopLabel={null}
      initialQuery=""
      mode={options.mode}
      profile={options.profile}
      surface={options.surface}
      resumeId={resumeId}
    />,
  );
}

async function runCliMode(options: any, resumeId: string | null) {
  const client = new OriClient();
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

  const turn = buildTurn({
    input: options.initialQuery,
    mode: state.mode,
    profile: state.requestedProfile,
    previousObjective: state.currentObjective,
    transcript: state.conversation,
    workspace,
  });

  process.stdout.write(`\n${CLR.salmon}⏺${CLR.reset} ${CLR.white}${CLR.bold}ORI${CLR.reset}\n`);
  process.stdout.write(`  ${CLR.gray}└ thinking...${CLR.reset}`);
  
  let lineCount = 1;
  const onStep = (title: string) => {
    // Clear current "thinking..." line and print real step
    process.stdout.write(`\r\x1b[2K  ${CLR.gray}└ ${title}${CLR.reset}\n`);
    // Print new placeholder for next step
    process.stdout.write(`  ${CLR.gray}└ thinking...${CLR.reset}`);
    lineCount++;
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

    // Clear all thinking lines (including the header)
    for (let i = 0; i < lineCount; i++) {
        process.stdout.write("\x1b[1A\x1b[2K");
    }
    process.stdout.write("\r");

    const content = executedTurn.response.choices?.[0]?.message?.content?.trim();
    if (content) {
      process.stdout.write(`${CLR.salmon}⏺${CLR.reset} ${CLR.white}${CLR.bold}ORI${CLR.reset}\n\n`);
      process.stdout.write(`${content}\n\n`);
      
      state.conversation.push({ role: "user", content: options.initialQuery });
      state.conversation.push({ role: "assistant", content });
      state.updatedAt = Date.now();
      await savePersistedSession(state);
    }
  } catch (err) {
    process.stdout.write(`\n${CLR.salmon}⏺${CLR.reset} ${CLR.white}${CLR.bold}Error:${CLR.reset} Request failed.\n`);
  }
}

boot().catch((err) => {
  console.error("ori-code: fatal boot error:", err);
  process.exit(1);
});
