export const DEFAULTS = {
  openAiModel: "gpt-5.5",
  anthropicModel: "claude-sonnet-4-5",
  googleModel: "gemini-3.5-flash",
  ollamaModel: "llama3.2",
  surface: "dev",
  profile: "switchbay",
  mode: "build",
  lane: "cloud",
  toolMode: "standard",
  openAiBase: "https://api.openai.com/v1",
  anthropicBase: "https://api.anthropic.com/v1",
  googleBase: "https://generativelanguage.googleapis.com/v1beta/openai",
  cloudProvider: "auto",
  ollamaBase: "http://localhost:11434/api",
} as const;

export type DefaultSurface = typeof DEFAULTS.surface;
export type DefaultProfile = typeof DEFAULTS.profile;
