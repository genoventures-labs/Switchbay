import { SWITCHBAY_VERSION } from "../version";

export type CliCommand = {
  usage: string;
  description: string;
  detail?: string;
  examples?: string[];
  options?: Array<{ flag: string; description: string }>;
};

export type CliSection = {
  title: string;
  commands: CliCommand[];
};

export type CliManifest = {
  version: string;
  sections: CliSection[];
  flags: Array<{ flag: string; description: string }>;
};

export function getCliManifest(): CliManifest {
  return {
    version: SWITCHBAY_VERSION,
    sections: [
      {
        title: "Getting Started",
        commands: [
          { usage: "switchbay", description: "Open the terminal workspace" },
          { usage: 'switchbay "<request>"', description: "Run a one-shot request against the active model" },
          { usage: "switchbay --resume [id]", description: "Continue a saved session" },
          { usage: "switchbay open", description: "Open the visual web workspace" },
          { usage: "switchbay docs", description: "Open the CLI reference in the web workspace" },
        ],
      },
      {
        title: "Models",
        commands: [
          {
            usage: "switchbay model",
            description: "Show the active model and lane",
          },
          {
            usage: "switchbay models [--lane <lane>] [--provider <provider>]",
            description: "List your model catalog",
            options: [
              { flag: "--lane <lane>", description: "cloud · local · apple · openrouter · huggingface" },
              { flag: "--provider <provider>", description: "openai · anthropic · google" },
              { flag: "--trusted", description: "Show only A/B graded models" },
              { flag: "--all", description: "All lanes in one view" },
            ],
          },
          {
            usage: "switchbay model add <id>",
            description: "Add a model to your catalog",
            examples: ["switchbay model add claude-opus-4-8", "switchbay model add gpt-4o --label \"GPT-4o\""],
          },
          {
            usage: "switchbay model remove <id>",
            description: "Remove a model from the catalog",
          },
          {
            usage: "switchbay model remove --lane <provider>",
            description: "Remove all models from a provider",
            examples: ["switchbay model remove --lane openai", "switchbay model remove --lane anthropic"],
          },
          {
            usage: "switchbay models clear [--provider <provider>]",
            description: "Clear all models, or all models for one provider",
            examples: ["switchbay models clear", "switchbay models clear --provider google"],
          },
          {
            usage: "switchbay model pull <id>",
            description: "Pull a local model via Ollama or Hugging Face",
            examples: ["switchbay model pull llama3.2", "switchbay model pull Qwen/Qwen2.5-0.5B-Instruct --lane llama-cpp"],
          },
          {
            usage: "switchbay model verify [<id>]",
            description: "Check a model is reachable and responding",
          },
          {
            usage: "switchbay local-mode set <mode>",
            description: "Restrict routing to local or go fully offline",
            options: [{ flag: "<mode>", description: "local · offline · off" }],
          },
          {
            usage: "switchbay local-provider set <provider>",
            description: "Switch the active local inference provider",
            options: [{ flag: "<provider>", description: "ollama · llama-cpp · mlx · apple-fm" }],
          },
        ],
      },
      {
        title: "Benchmarking",
        commands: [
          {
            usage: "switchbay benchmark --pre",
            description: "Grade your entire model catalog — runs the 4 highest-signal tests concurrently across all models",
          },
          {
            usage: "switchbay benchmark [<model-id>] [--lane <lane>]",
            description: "Run the full 10-test benchmark suite on one model, scored A+–F",
            examples: ["switchbay benchmark", "switchbay benchmark claude-opus-4-8 --lane cloud"],
          },
          {
            usage: "switchbay models --trusted",
            description: "Show only models with A or B grade from a prior bench run",
          },
        ],
      },
      {
        title: "Brief",
        commands: [
          {
            usage: "switchbay brief",
            description: "List Brief documents in this workspace",
          },
          {
            usage: 'switchbay brief create "<name>"',
            description: "Create a new empty Brief document",
            examples: ['switchbay brief create "Q3 Strategy"'],
          },
          {
            usage: 'switchbay brief draft "<prompt>" [--name <name>]',
            description: "AI-draft a Brief document and open it in the workspace",
            examples: [
              'switchbay brief draft "Write a product brief for our API gateway" --name "API Gateway Brief"',
              'switchbay brief draft "Summarise the current sprint goals"',
            ],
          },
        ],
      },
      {
        title: "Capabilities",
        commands: [
          { usage: "switchbay sync", description: "Sync engines and skills from remote in one shot" },
          { usage: "switchbay engines list", description: "Installed Engine Bay tools" },
          { usage: "switchbay engines sync", description: "Pull the latest engine definitions" },
          { usage: "switchbay skills list", description: "Skill library guides" },
          { usage: "switchbay skills sync", description: "Pull the latest skills" },
          { usage: "switchbay agents list", description: "Specialist agent workers" },
          { usage: "switchbay mcp catalog", description: "MCP tool bridge catalog" },
          { usage: "switchbay plugins list", description: "Installed capability packs" },
        ],
      },
      {
        title: "Workspace",
        commands: [
          { usage: "switchbay memory", description: "Workspace memory and facts" },
          {
            usage: "switchbay knowledge search <query>",
            description: "Search indexed workspace documents",
            examples: ["switchbay knowledge search authentication"],
          },
          {
            usage: "switchbay task add / done / clear",
            description: "Today's task list",
            examples: ["switchbay task add \"Review PR\"", "switchbay task done 1"],
          },
          { usage: "switchbay handoff", description: "Wrap the session and prep context for the next" },
        ],
      },
      {
        title: "Inspection",
        commands: [
          { usage: "switchbay trace", description: "Last turn receipt — model, tools, tokens" },
          { usage: "switchbay usage", description: "Turns, tokens, tool calls, and estimated spend" },
          { usage: "switchbay radar", description: "Friction Radar preflight check" },
          { usage: "switchbay graph trace", description: "Execution flow visualizer" },
        ],
      },
      {
        title: "System",
        commands: [
          { usage: "switchbay update", description: "Update, rebuild, and refresh" },
          { usage: "switchbay serve [--detach]", description: "Start the local API server" },
          { usage: "switchbay service status", description: "Check the startup service" },
          { usage: "switchbay service install", description: "Install as a system service (macOS)" },
          { usage: "switchbay service restart", description: "Restart the service" },
          { usage: "switchbay service uninstall", description: "Remove the system service" },
        ],
      },
    ],
    flags: [
      { flag: "--lane <lane>", description: "cloud · local · apple · openrouter · huggingface" },
      { flag: "--hop <path>", description: "Switch to another workspace for this turn" },
      { flag: "--vision <img>", description: "Attach an image to the turn" },
      { flag: "--new", description: "Start a clean session" },
      { flag: "--resume [id]", description: "Resume a saved session by ID or latest" },
      { flag: "--mode <mode>", description: "build · design · debug" },
      { flag: "--profile <profile>", description: "Agent profile to load" },
      { flag: "--deep-research", description: "Structured multi-step research mode" },
    ],
  };
}
