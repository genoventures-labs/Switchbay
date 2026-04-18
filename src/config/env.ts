import { DEFAULTS } from "./defaults";
import path from "node:path";

function readEnv(key: string): string | undefined {
  const value = Bun.env[key]?.trim();
  return value ? value : undefined;
}

export function getApiBase(): string {
  return readEnv("ORI_API_BASE") ?? DEFAULTS.apiBase;
}

export function getDefaultModel(): string {
  return readEnv("ORI_MODEL") ?? DEFAULTS.model;
}

export function getWebSocketBase(): string {
  return readEnv("ORI_WS_BASE") ?? DEFAULTS.wsBase;
}

export function getApiKey(): string | undefined {
  return readEnv("ORI_API_KEY");
}

export function getDebugEmptyResponses(): boolean {
  const value = readEnv("ORI_DEBUG_EMPTY_RESPONSES");
  return value === "1" || value === "true" || value === "yes";
}

export function getRuntimeEnvironmentHeaders(cwd = process.cwd()) {
  return {
    os: readEnv("ORI_ENV_OS") ?? process.platform,
    pwd: readEnv("ORI_ENV_PWD") ?? cwd,
    project: readEnv("ORI_ENV_PROJECT") ?? path.basename(cwd),
    shell: readEnv("ORI_ENV_SHELL") ?? Bun.env.SHELL ?? "unknown",
  };
}
