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
  return normalizeRuntimeLane(readFirstEnv("SWITCHBAY_LANE", "HARNESS_LANE", "ORI_LANE"));
}

export function getDefaultModel(): string {
  if (getRuntimeLane() === "local") {
    return (
      readEnv("SWITCHBAY_LMSTUDIO_MODEL") ??
      readEnv("HARNESS_LMSTUDIO_MODEL") ??
      readEnv("ORI_LMSTUDIO_MODEL") ??
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
    readEnv("HARNESS_CLOUD_PROVIDER") ??
    readEnv("ORI_CLOUD_PROVIDER") ??
    readEnv("SWITCHBAY_CLOUD_ROUTER") ??
    readEnv("HARNESS_CLOUD_ROUTER") ??
    readEnv("ORI_CLOUD_ROUTER") ??
    DEFAULTS.cloudProvider
  ).toLowerCase();
  if (provider === "openai" || provider === "anthropic") {
    return provider;
  }
  return "auto";
}

export function getOpenAiBase(): string {
  return readFirstEnv("SWITCHBAY_OPENAI_BASE", "HARNESS_OPENAI_BASE", "ORI_OPENAI_BASE", "OPENAI_BASE_URL") ?? DEFAULTS.openAiBase;
}

export function getOpenAiApiKey(): string | undefined {
  return readEnv("OPENAI_API_KEY");
}

export function getOpenAiModel(): string {
  return readFirstEnv("SWITCHBAY_OPENAI_MODEL", "HARNESS_OPENAI_MODEL", "ORI_OPENAI_MODEL", "OPENAI_MODEL") ?? DEFAULTS.openAiModel;
}

export function getAnthropicBase(): string {
  return readFirstEnv("SWITCHBAY_ANTHROPIC_BASE", "HARNESS_ANTHROPIC_BASE", "ORI_ANTHROPIC_BASE", "ANTHROPIC_BASE_URL") ?? DEFAULTS.anthropicBase;
}

export function getAnthropicApiKey(): string | undefined {
  return readEnv("ANTHROPIC_API_KEY");
}

export function getAnthropicModel(): string {
  return readFirstEnv("SWITCHBAY_ANTHROPIC_MODEL", "HARNESS_ANTHROPIC_MODEL", "ORI_ANTHROPIC_MODEL", "ANTHROPIC_MODEL") ?? DEFAULTS.anthropicModel;
}

export function getLmStudioBase(): string {
  const base =
    readEnv("SWITCHBAY_LMSTUDIO_BASE") ??
    readEnv("HARNESS_LMSTUDIO_BASE") ??
    readEnv("ORI_LMSTUDIO_BASE") ??
    readEnv("LMSTUDIO_API_BASE") ??
    readEnv("LMSTUDIO_API_URL") ??
    DEFAULTS.lmStudioBase;
  return base.endsWith("/v1") ? base : `${base.replace(/\/$/, "")}/v1`;
}

export function getLmStudioApiKey(): string | undefined {
  return readFirstEnv("SWITCHBAY_LMSTUDIO_API_KEY", "HARNESS_LMSTUDIO_API_KEY", "ORI_LMSTUDIO_API_KEY", "LMSTUDIO_API_KEY");
}

export function getDebugEmptyResponses(): boolean {
  const value = readFirstEnv("SWITCHBAY_DEBUG_EMPTY_RESPONSES", "HARNESS_DEBUG_EMPTY_RESPONSES", "ORI_DEBUG_EMPTY_RESPONSES");
  return value === "1" || value === "true" || value === "yes";
}

export function getRuntimeEnvironmentHeaders(cwd = process.cwd()) {
  return {
    os: readFirstEnv("SWITCHBAY_ENV_OS", "HARNESS_ENV_OS", "ORI_ENV_OS") ?? process.platform,
    pwd: readFirstEnv("SWITCHBAY_ENV_PWD", "HARNESS_ENV_PWD", "ORI_ENV_PWD") ?? cwd,
    project: readFirstEnv("SWITCHBAY_ENV_PROJECT", "HARNESS_ENV_PROJECT", "ORI_ENV_PROJECT") ?? path.basename(cwd),
    shell: readFirstEnv("SWITCHBAY_ENV_SHELL", "HARNESS_ENV_SHELL", "ORI_ENV_SHELL") ?? Bun.env.SHELL ?? "unknown",
  };
}
