import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { OriClient } from "./src/runtime/ori-client";
import { OriApp } from "./src/tui/app";
import { loadOriConfig } from "./src/config/ori-config";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";

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
  ori-code --new                    Start a fresh session
  ori-code update                   Print update instructions
  ori-code version                  Print version

Options:
  -s, --surface <type>   Surface context (default: dev)
  -p, --profile <name>   Working style (default: ori_code)
  -m, --mode <name>      Agent mode: build | design | debug (default: build)
  --hop <name>           Travel to a whitelisted location before launching
  --resume               Resume the last saved session state
  --new                  Force a fresh session even if a saved one exists
`);
    return;
  }

  if (options.subcommand !== "run") return;

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
      resume={options.resume && !options.newSession}
    />,
  );
}

boot().catch((err) => {
  console.error("ori-code: fatal boot error:", err);
  process.exit(1);
});
