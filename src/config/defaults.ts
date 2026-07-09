export const DEFAULTS = {
  openAiModel: "gpt-5.5",
  anthropicModel: "claude-sonnet-4-5",
  lmStudioModel: "qwen2.5-7b-instruct",
  ollamaModel: "llama3.2",
  surface: "dev",
  profile: "switchbay",
  mode: "build",
  lane: "cloud",
  toolMode: "standard",
  openAiBase: "https://api.openai.com/v1",
  anthropicBase: "https://api.anthropic.com/v1",
  cloudProvider: "auto",
  lmStudioBase: "http://127.0.0.1:1234/v1",
  ollamaBase: "http://localhost:11434/api",
} as const;

export type DefaultSurface = typeof DEFAULTS.surface;
export type DefaultProfile = typeof DEFAULTS.profile;
