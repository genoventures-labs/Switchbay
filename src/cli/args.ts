import { DEFAULTS } from "../config/defaults";

export type CliOptions = {
  surface: string;
  profile: string;
  mode: string;
  lane: string | null;
  initialQuery: string;
  hop: string | null;
  resume: string | boolean; // string (id/index) or true (latest)
  newSession: boolean;
  purge: string | null;
  subcommand: "run" | "update" | "version" | "help";
};

export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let surface: string = DEFAULTS.surface;
  let profile: string = DEFAULTS.profile;
  let mode: string = DEFAULTS.mode;
  let lane: string | null = null;
  let hop: string | null = null;
  let resume: string | boolean = false;
  let newSession = false;
  let purge: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" || arg === "--surface") {
      surface = args[++i] ?? DEFAULTS.surface;
    } else if (arg === "-p" || arg === "--profile") {
      profile = args[++i] ?? DEFAULTS.profile;
    } else if (arg === "-m" || arg === "--mode") {
      mode = args[++i] ?? DEFAULTS.mode;
    } else if (arg === "--lane") {
      lane = args[++i] ?? null;
    } else if (arg === "--hop") {
      hop = args[++i] ?? null;
    } else if (arg === "--resume") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        resume = next;
        i++;
      } else {
        resume = true;
      }
    } else if (arg === "--new") {
      newSession = true;
    } else if (arg === "--purge") {
      purge = args[++i] ?? null;
    } else if (arg === "update") {
      console.log("Run this to update the coding harness:\n");
      console.log("  bun install -g github:genoventures-labs/ori-code#main\n");
      process.exit(0);
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      console.log("code-harness 0.9.46");
      process.exit(0);
    } else if (arg === undefined || arg === "help" || arg === "--help" || arg === "-h") {
      return { surface, profile, mode, lane, initialQuery: "", hop: null, resume: false, newSession: false, purge: null, subcommand: "help" };
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return {
    surface,
    profile,
    mode,
    lane,
    initialQuery: positional.join(" "),
    hop,
    resume,
    newSession,
    purge,
    subcommand: "run",
  };
}
