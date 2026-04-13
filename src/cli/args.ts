import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { DEFAULTS } from "../config/defaults";

export type CliOptions = {
  surface: string;
  profile: string;
  mode: string;
  initialQuery: string;
  subcommand: "run" | "update" | "version";
};

export function parseCliArgs(argv: string[]): CliOptions {
  const subcommand = argv[2];

  if (subcommand === "update") {
    console.log("Updating ori-code...");
    const result = spawnSync(
      "bun",
      ["install", "-g", "github:cassianwolfe/ori-code#main"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      console.error("Update failed. Run manually: bun install -g github:cassianwolfe/ori-code#main");
      process.exit(1);
    }
    console.log("ori-code updated.");
    process.exit(0);
  }

  if (subcommand === "version") {
    console.log("ori-code 0.1.0");
    process.exit(0);
  }

  const program = new Command();

  program
    .name("ori-code")
    .description("ORI Code — terminal coding agent powered by ORI")
    .option("-s, --surface <type>", "Surface context", DEFAULTS.surface)
    .option("-p, --profile <name>", "Working style", DEFAULTS.profile)
    .option("-m, --mode <name>", "Agent mode", DEFAULTS.mode)
    .argument("[query...]", "One-shot request")
    .allowUnknownOption(false);

  program.parse(argv);

  const options = program.opts<{
    surface: string;
    profile: string;
    mode: string;
  }>();

  return {
    surface: options.surface,
    profile: options.profile,
    mode: options.mode,
    initialQuery: program.args.join(" "),
    subcommand: "run",
  };
}
