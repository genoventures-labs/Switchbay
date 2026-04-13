import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { OriClient } from "./src/runtime/ori-client";
import { OriApp } from "./src/tui/app";

const options = parseCliArgs(process.argv);
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
