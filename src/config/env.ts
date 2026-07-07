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

export type RuntimeLane = "cloud" | "local";
export type CloudProvider = "auto" | "openai" | "anthropic";

export function normalizeRuntimeLane(value?: string | null): RuntimeLane {
  const lane = (value ?? DEFAULTS.lane).toLowerCase();
  if (lane === "local" || lane === "lm" || lane === "lmstudio") {
    return "local";
  }
  return "cloud";
}

export function getRuntimeLane(): RuntimeLane {
  return normalizeRuntimeLane(readFirstEnv("SWITCHBAY_LANE"));
}

export function getDefaultModel(): string {
  if (getRuntimeLane() === "local") {
    return (
      readEnv("SWITCHBAY_LMSTUDIO_MODEL") ??
      readEnv("LMSTUDIO_DEFAULT_MODEL") ??
      DEFAULTS.lmStudioModel
    );
  }

  const provider = getCloudProvider();
  if (provider === "anthropic") {
    return getAnthropicModel();
  }
  return getOpenAiModel();
}

export function getCloudProvider(): CloudProvider {
  const provider = (
    readEnv("SWITCHBAY_CLOUD_PROVIDER") ??
    readEnv("SWITCHBAY_CLOUD_ROUTER") ??
    DEFAULTS.cloudProvider
  ).toLowerCase();
  if (provider === "openai" || provider === "anthropic") {
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

export function getLmStudioBase(): string {
  const base =
    readEnv("SWITCHBAY_LMSTUDIO_BASE") ??
    readEnv("LMSTUDIO_API_BASE") ??
    readEnv("LMSTUDIO_API_URL") ??
    DEFAULTS.lmStudioBase;
  return base.endsWith("/v1") ? base : `${base.replace(/\/$/, "")}/v1`;
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
