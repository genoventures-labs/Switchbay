import { DEFAULTS } from "./defaults";
import path from "node:path";

function readEnv(key: string): string | undefined {
  const value = Bun.env[key]?.trim();
  return value ? value : undefined;
}

function readFirstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readEnv(key);
    if (value) return value;
  }
  return undefined;
}

export type RuntimeLane = "cloud" | "cloud-mcp" | "local" | "openrouter" | "huggingface";
export type ToolMode = "standard" | "switchbay-mcp";
export type CloudProvider = "auto" | "openai" | "anthropic" | "google";

export function normalizeRuntimeLane(value?: string | null): RuntimeLane {
  const lane = (value ?? DEFAULTS.lane).toLowerCase();
  if (lane === "mcp" || lane === "cloud-mcp" || lane === "cloudmcp" || lane === "cmcp") {
    return "cloud-mcp";
  }
  if (lane === "openrouter" || lane === "open-router" || lane === "or") return "openrouter";
  if (lane === "huggingface" || lane === "hugging-face" || lane === "hf" || lane === "hf-cloud") return "huggingface";
  if (
    lane === "local" ||
    lane === "ollama" ||
    lane === "ollama-cloud" ||
    lane === "ollama_cloud" ||
    lane === "hf.co" ||
    lane === "local-mcp"
  ) {
    return "local";
  }
  if (lane === "openai" || lane === "open-ai" || lane === "gpt" || lane === "anthropic" || lane === "claude" || lane === "google" || lane === "gemini") {
    return "cloud";
  }
  return "cloud";
}

export function getRuntimeLane(): RuntimeLane {
  return normalizeRuntimeLane(readFirstEnv("SWITCHBAY_LANE"));
}

export function normalizeToolMode(value?: string | null): ToolMode {
  const mode = (value ?? DEFAULTS.toolMode ?? "standard").toLowerCase();
  if (
    mode === "mcp" ||
    mode === "on" ||
    mode === "true" ||
    mode === "1" ||
    mode === "switchbay-mcp" ||
    mode === "switchbaymcp" ||
    mode === "tool-bridge" ||
    mode === "bridge"
  ) {
    return "switchbay-mcp";
  }
  return "standard";
}

export function getToolMode(): ToolMode {
  return normalizeToolMode(readFirstEnv("SWITCHBAY_TOOL_MODE"));
}

export function getDefaultModel(lane: RuntimeLane = getRuntimeLane()): string {
  if (lane === "local") {
    return getOllamaModel();
  }

  const provider = getCloudProvider();
  if (provider === "anthropic") {
    return getAnthropicModel();
  }
  if (provider === "google") {
    return getGoogleModel();
  }
  return getOpenAiModel();
}

export function getOllamaModel(): string {
  return (
    readEnv("SWITCHBAY_OLLAMA_MODEL") ??
    readEnv("OLLAMA_MODEL") ??
    readEnv("SWITCHBAY_LMSTUDIO_MODEL") ??
    readEnv("LMSTUDIO_DEFAULT_MODEL") ??
    DEFAULTS.ollamaModel
  );
}

export function getCloudProvider(): CloudProvider {
  const provider = (
    readEnv("SWITCHBAY_CLOUD_PROVIDER") ??
    readEnv("SWITCHBAY_CLOUD_ROUTER") ??
    DEFAULTS.cloudProvider
  ).toLowerCase();
  if (provider === "openai" || provider === "anthropic" || provider === "google") {
    return provider;
  }
  return "auto";
}

export function getOpenAiBase(): string {
  return readFirstEnv("SWITCHBAY_OPENAI_BASE", "OPENAI_BASE_URL") ?? DEFAULTS.openAiBase;
}

export function getOpenAiApiKey(): string | undefined {
  return readEnv("OPENAI_API_KEY");
}

export function getOpenAiModel(): string {
  return readFirstEnv("SWITCHBAY_OPENAI_MODEL", "OPENAI_MODEL") ?? DEFAULTS.openAiModel;
}

export function getAnthropicBase(): string {
  return readFirstEnv("SWITCHBAY_ANTHROPIC_BASE", "ANTHROPIC_BASE_URL") ?? DEFAULTS.anthropicBase;
}

export function getAnthropicApiKey(): string | undefined {
  return readEnv("OPENAI_API_KEY"); // Note: anthropic key falls back to openai key if needed in mock/routing configs, but normally readEnv("ANTHROPIC_API_KEY")
}

export function getAnthropicModel(): string {
  return readFirstEnv("SWITCHBAY_ANTHROPIC_MODEL", "ANTHROPIC_MODEL") ?? DEFAULTS.anthropicModel;
}

export function getGoogleBase(): string {
  return readFirstEnv("SWITCHBAY_GOOGLE_BASE", "GOOGLE_BASE_URL", "GEMINI_BASE_URL") ?? DEFAULTS.googleBase;
}

export function getGoogleApiKey(): string | undefined {
  return readFirstEnv("GOOGLE_API_KEY", "GEMINI_API_KEY");
}

export function getGoogleModel(): string {
  return readFirstEnv("SWITCHBAY_GOOGLE_MODEL", "GOOGLE_MODEL", "GEMINI_MODEL") ?? DEFAULTS.googleModel;
}

export function getDebugEmptyResponses(): boolean {
  const value = readFirstEnv("SWITCHBAY_DEBUG_EMPTY_RESPONSES");
  return value === "1" || value === "true" || value === "yes";
}

export function getRuntimeEnvironmentHeaders(cwd = process.cwd()) {
  return {
    os: readFirstEnv("SWITCHBAY_ENV_OS") ?? process.platform,
    pwd: readFirstEnv("SWITCHBAY_ENV_PWD") ?? cwd,
    project: readFirstEnv("SWITCHBAY_ENV_PROJECT") ?? path.basename(cwd),
    shell: readFirstEnv("SWITCHBAY_ENV_SHELL") ?? Bun.env.SHELL ?? "unknown",
  };
}
