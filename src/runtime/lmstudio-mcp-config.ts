import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { getLmStudioModel, getLmStudioNativeBase } from "../config/env";
import { userConfigPath } from "../config/paths";

export const LMSTUDIO_MCP_CONFIG_FILE = "lmstudio.mcp.json";

export type LmStudioMcpIntegration =
  | string
  | {
      type: "plugin";
      id: string;
      allowed_tools?: string[];
    }
  | {
      type: "ephemeral_mcp";
      server_label: string;
      server_url: string;
      allowed_tools?: string[];
      headers?: Record<string, string>;
    };

export type LmStudioMcpConfig = {
  enabled?: boolean;
  nativeBase?: string;
  model?: string;
  systemPrompt?: string;
  contextLength?: number;
  integrations?: LmStudioMcpIntegration[];
  mcpServers?: Record<string, unknown>;
};

export type LmStudioMcpConfigStatus = {
  config: LmStudioMcpConfig;
  exists: boolean;
  path: string;
  integrations: LmStudioMcpIntegration[];
};

export function lmStudioMcpConfigPath(cwd = process.cwd()): string {
  void cwd;
  const configured = Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG?.trim();
  if (configured) return resolve(configured.replace(/^~/, os.homedir()));
  return userConfigPath(LMSTUDIO_MCP_CONFIG_FILE);
}

export async function loadLmStudioMcpConfig(cwd = process.cwd()): Promise<LmStudioMcpConfigStatus> {
  const path = lmStudioMcpConfigPath(cwd);
  if (!existsSync(path)) {
    const config = createDefaultLmStudioMcpConfig();
    return { config, exists: false, path, integrations: resolveLmStudioMcpIntegrations(config) };
  }

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as LmStudioMcpConfig;
  return { config: parsed, exists: true, path, integrations: resolveLmStudioMcpIntegrations(parsed) };
}

export async function saveLmStudioMcpConfig(config: LmStudioMcpConfig, cwd = process.cwd()): Promise<string> {
  const path = lmStudioMcpConfigPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return path;
}

export function createDefaultLmStudioMcpConfig(): LmStudioMcpConfig {
  return {
    enabled: true,
    nativeBase: getLmStudioNativeBase(),
    model: getLmStudioModel(),
    integrations: [],
    mcpServers: {},
  };
}

export function resolveLmStudioMcpIntegrations(config: LmStudioMcpConfig): LmStudioMcpIntegration[] {
  if (Array.isArray(config.integrations) && config.integrations.length > 0) {
    return config.integrations;
  }

  return Object.keys(config.mcpServers ?? {})
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `mcp/${name}`);
}

export function describeLmStudioMcpConfig(status: LmStudioMcpConfigStatus): string {
  const integrations = status.integrations.length
    ? status.integrations.map((item) => `- \`${formatIntegrationLabel(item)}\``).join("\n")
    : "- No integrations configured yet.";

  return [
    "**LM Studio MCP Lane**",
    "",
    `Config: \`${status.path}\`${status.exists ? "" : " (not created yet)"}`,
    `Native API: \`${status.config.nativeBase ?? getLmStudioNativeBase()}\``,
    `Model: \`${status.config.model ?? getLmStudioModel()}\``,
    `Enabled: \`${status.config.enabled === false ? "false" : "true"}\``,
    "",
    "Integrations:",
    integrations,
    "",
    status.integrations.length
      ? "Use `/lane mcp` to switch lanes and `/model mcp` to select local models for it."
      : "Add LM Studio-installed MCP server ids like `mcp/<server-label>` to `integrations`, then use `/lane mcp`.",
  ].join("\n");
}

export function formatIntegrationLabel(item: LmStudioMcpIntegration): string {
  if (typeof item === "string") return item;
  if (item.type === "plugin") return item.id;
  return `${item.server_label} (${item.server_url})`;
}
