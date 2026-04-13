import { DEFAULTS } from "../config/defaults";

export type CliOptions = {
  surface: string;
  profile: string;
  mode: string;
  initialQuery: string;
  subcommand: "run" | "update" | "version" | "help";
};

export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let surface: string = DEFAULTS.surface;
  let profile: string = DEFAULTS.profile;
  let mode: string = DEFAULTS.mode;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" || arg === "--surface") {
      surface = args[++i] ?? DEFAULTS.surface;
    } else if (arg === "-p" || arg === "--profile") {
      profile = args[++i] ?? DEFAULTS.profile;
    } else if (arg === "-m" || arg === "--mode") {
      mode = args[++i] ?? DEFAULTS.mode;
    } else if (arg === "update") {
      console.log("Run this to update ori-code:\n");
      console.log("  bun remove -g ori-code && bun install -g github:cassianwolfe/ori-code#main\n");
      process.exit(0);
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      console.log("ori-code 0.2.3");
      process.exit(0);
    } else if (arg === undefined || arg === "help" || arg === "--help" || arg === "-h") {
      return { surface, profile, mode, initialQuery: "", subcommand: "help" };
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return {
    surface,
    profile,
    mode,
    initialQuery: positional.join(" "),
    subcommand: "run",
  };
}
