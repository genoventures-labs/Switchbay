import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { OriClient } from "./src/runtime/ori-client";
import { OriApp } from "./src/tui/app";

const options = parseCliArgs(process.argv);

if (options.subcommand === "run") {
  const client = new OriClient();
  render(
    <OriApp
      client={client}
      initialQuery={options.initialQuery}
      mode={options.mode}
      profile={options.profile}
      surface={options.surface}
    />,
  );
} else if (options.subcommand === "help") {
  console.log(`
ORI Code — terminal coding agent powered by ORI

Usage:
  ori-code              Launch the TUI (interactive mode)
  ori-code "query"      One-shot request
  ori-code update       Print update instructions
  ori-code version      Print version

Options:
  -s, --surface <type>  Surface context (default: dev)
  -p, --profile <name>  Working style (default: ori_code)
  -m, --mode <name>     Agent mode: build | design | debug (default: build)
`);
}
