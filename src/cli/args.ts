import { Command } from "commander";
import { DEFAULTS } from "../config/defaults";

export type CliOptions = {
  surface: string;
  profile: string;
  mode: string;
  initialQuery: string;
};

export function parseCliArgs(argv: string[]): CliOptions {
  const program = new Command();

  program
    .name("ori")
    .description("ORI Code - Terminal Interface")
    .option("-s, --surface <type>", "Surface context", DEFAULTS.surface)
    .option("-p, --profile <name>", "Working style", DEFAULTS.profile)
    .option("-m, --mode <name>", "Agent mode", DEFAULTS.mode)
    .argument("[query...]", "One-shot request");

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
  };
}
