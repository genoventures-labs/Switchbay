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

export type RuntimeLane = "cloud" | "cloud-mcp" | "local" | "local-mcp";
export type ToolMode = "standard" | "switchbay-mcp";
export type CloudProvider = "auto" | "openai" | "anthropic" | "google";

export function normalizeRuntimeLane(value?: string | null): RuntimeLane {
  const lane = (value ?? DEFAULTS.lane).toLowerCase();
  if (lane === "mcp" || lane === "cloud-mcp" || lane === "cloudmcp" || lane === "cmcp") {
    return "cloud-mcp";
  }
  if (lane === "native-mcp" || lane === "local-mcp" || lane === "lm-mcp" || lane === "lmstudio-mcp") {
    return "local-mcp";
  }
  if (lane === "local" || lane === "lm" || lane === "lmstudio" || lane === "lm-studio" || lane === "ollama" || lane === "huggingface" || lane === "hf" || lane === "hf.co") {
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
    mode === "bridge"
  ) {
    return "switchbay-mcp";
  }
  return "standard";
}

export function getToolMode(): ToolMode {
  return normalizeToolMode(readFirstEnv("SWITCHBAY_TOOL_MODE", "SWITCHBAY_MCP"));
}

export function getDefaultModel(): string {
  const lane = getRuntimeLane();
  if (lane === "local") {
    const localProvider = readEnv("SWITCHBAY_LOCAL_PROVIDER")?.toLowerCase();
    if (localProvider === "ollama" || localProvider === "ol") {
      return getOllamaModel();
    }
    try {
      const configPath = path.join(
        Bun.env.HOME ?? Bun.env.USERPROFILE ?? "",
        ".switchbay",
        "local-providers.json"
      );
      if (require("node:fs").existsSync(configPath)) {
        const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));
        if (config.active === "ollama") {
          return getOllamaModel();
        }
      }
    } catch {
      // Ignore
    }
    return getLmStudioModel();
  }
  if (lane === "local-mcp") {
    return getLmStudioModel();
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

export function getLmStudioModel(): string {
  return (
    readEnv("SWITCHBAY_LMSTUDIO_MODEL") ??
    readEnv("LMSTUDIO_DEFAULT_MODEL") ??
    DEFAULTS.lmStudioModel
  );
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
  return readEnv("ANTHROPIC_API_KEY");
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

export function getLmStudioBase(): string {
  const base =
    readEnv("SWITCHBAY_LMSTUDIO_BASE") ??
    readEnv("LMSTUDIO_API_BASE") ??
    readEnv("LMSTUDIO_API_URL") ??
    DEFAULTS.lmStudioBase;
  return base.endsWith("/v1") ? base : `${base.replace(/\/$/, "")}/v1`;
}

export function getLmStudioNativeBase(): string {
  const nativeBase = readFirstEnv("SWITCHBAY_LMSTUDIO_NATIVE_BASE", "LMSTUDIO_NATIVE_API_BASE");
  if (nativeBase) {
    return nativeBase.endsWith("/api/v1") ? nativeBase : `${nativeBase.replace(/\/$/, "")}/api/v1`;
  }

  return getLmStudioBase().replace(/\/v1$/, "/api/v1");
}

export function getLmStudioApiKey(): string | undefined {
  return readFirstEnv("SWITCHBAY_LMSTUDIO_API_KEY", "LMSTUDIO_API_KEY");
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
