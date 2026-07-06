import { DEFAULTS } from "./defaults";
import path from "node:path";

function readEnv(key: string): string | undefined {
  const value = Bun.env[key]?.trim();
  return value ? value : undefined;
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
  return normalizeRuntimeLane(readEnv("HARNESS_LANE") ?? readEnv("ORI_LANE"));
}

export function getDefaultModel(): string {
  if (getRuntimeLane() === "local") {
    return (
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
    readEnv("HARNESS_CLOUD_PROVIDER") ??
    readEnv("ORI_CLOUD_PROVIDER") ??
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
  return readEnv("HARNESS_OPENAI_BASE") ?? readEnv("ORI_OPENAI_BASE") ?? readEnv("OPENAI_BASE_URL") ?? DEFAULTS.openAiBase;
}

export function getOpenAiApiKey(): string | undefined {
  return readEnv("OPENAI_API_KEY");
}

export function getOpenAiModel(): string {
  return readEnv("HARNESS_OPENAI_MODEL") ?? readEnv("ORI_OPENAI_MODEL") ?? readEnv("OPENAI_MODEL") ?? DEFAULTS.openAiModel;
}

export function getAnthropicBase(): string {
  return readEnv("HARNESS_ANTHROPIC_BASE") ?? readEnv("ORI_ANTHROPIC_BASE") ?? readEnv("ANTHROPIC_BASE_URL") ?? DEFAULTS.anthropicBase;
}

export function getAnthropicApiKey(): string | undefined {
  return readEnv("ANTHROPIC_API_KEY");
}

export function getAnthropicModel(): string {
  return readEnv("HARNESS_ANTHROPIC_MODEL") ?? readEnv("ORI_ANTHROPIC_MODEL") ?? readEnv("ANTHROPIC_MODEL") ?? DEFAULTS.anthropicModel;
}

export function getLmStudioBase(): string {
  const base =
    readEnv("HARNESS_LMSTUDIO_BASE") ??
    readEnv("ORI_LMSTUDIO_BASE") ??
    readEnv("LMSTUDIO_API_BASE") ??
    readEnv("LMSTUDIO_API_URL") ??
    DEFAULTS.lmStudioBase;
  return base.endsWith("/v1") ? base : `${base.replace(/\/$/, "")}/v1`;
}

export function getLmStudioApiKey(): string | undefined {
  return readEnv("HARNESS_LMSTUDIO_API_KEY") ?? readEnv("ORI_LMSTUDIO_API_KEY") ?? readEnv("LMSTUDIO_API_KEY");
}

export function getDebugEmptyResponses(): boolean {
  const value = readEnv("HARNESS_DEBUG_EMPTY_RESPONSES") ?? readEnv("ORI_DEBUG_EMPTY_RESPONSES");
  return value === "1" || value === "true" || value === "yes";
}

export function getRuntimeEnvironmentHeaders(cwd = process.cwd()) {
  return {
    os: readEnv("HARNESS_ENV_OS") ?? readEnv("ORI_ENV_OS") ?? process.platform,
    pwd: readEnv("HARNESS_ENV_PWD") ?? readEnv("ORI_ENV_PWD") ?? cwd,
    project: readEnv("HARNESS_ENV_PROJECT") ?? readEnv("ORI_ENV_PROJECT") ?? path.basename(cwd),
    shell: readEnv("HARNESS_ENV_SHELL") ?? readEnv("ORI_ENV_SHELL") ?? Bun.env.SHELL ?? "unknown",
  };
}
