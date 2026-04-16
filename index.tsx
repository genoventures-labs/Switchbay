import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { OriClient } from "./src/runtime/ori-client";
import { OriApp } from "./src/tui/app";
import { loadOriConfig } from "./src/config/ori-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions } from "./src/session/persistence";

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
      // Check if it's a numeric index
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
        resumeId = options.resume; // Assume it's a UUID
      }
    } else {
      // --resume without value = latest
      resumeId = "latest";
    }
  }

  // Resolve --hop before rendering so the TUI boots in the right cwd
  let initialHopLabel: string | null = null;
  if (options.hop) {
    const matches = await fuzzyMatchLocations(options.hop);
    if (matches.length === 0) {
      console.error(`ori-code: --hop: no whitelisted location matched "${options.hop}"`);
      process.exit(1);
    }
    const best = matches[0]!;
    const result = await travelTo(best.absPath);
    if (!result.ok) {
      console.error(`ori-code: --hop failed: ${result.error}`);
      process.exit(1);
    }
    initialHopLabel = result.location!.label;
  }

  const client = new OriClient();
  render(
    <OriApp
      client={client}
      initialHopLabel={initialHopLabel}
      initialQuery={options.initialQuery}
      mode={options.mode}
      profile={options.profile}
      surface={options.surface}
      resumeId={resumeId}
    />,
  );
}

boot().catch((err) => {
  console.error("ori-code: fatal boot error:", err);
  process.exit(1);
});
