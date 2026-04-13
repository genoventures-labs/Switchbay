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
  const program = new Command();

  program
    .name("ori-code")
    .description("ORI Code — terminal coding agent powered by ORI")
    .option("-s, --surface <type>", "Surface context", DEFAULTS.surface)
    .option("-p, --profile <name>", "Working style", DEFAULTS.profile)
    .option("-m, --mode <name>", "Agent mode", DEFAULTS.mode)
    .argument("[query...]", "One-shot request");

  program
    .command("update")
    .description("Update ori-code to the latest version from GitHub")
    .action(() => {
      console.log("Updating ori-code...");
      const result = spawnSync(
        "bun",
        ["install", "-g", "github:cassianwolfe/ori-code"],
        { stdio: "inherit" },
      );
      if (result.status === 0) {
        console.log("ori-code updated successfully.");
      } else {
        console.error("Update failed. Run manually: bun install -g github:cassianwolfe/ori-code");
        process.exit(1);
      }
      process.exit(0);
    });

  program
    .command("version")
    .description("Print the current version")
    .action(() => {
      // Resolved at build time via Bun's --define or package.json import
      console.log("ori-code 0.1.0");
      process.exit(0);
    });

  program.parse(argv);

  const subcommand = argv[2];
  if (subcommand === "update" || subcommand === "version") {
    return {
      surface: DEFAULTS.surface,
      profile: DEFAULTS.profile,
      mode: DEFAULTS.mode,
      initialQuery: "",
      subcommand,
    };
  }

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
