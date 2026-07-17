import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { userConfigPath } from "../config/paths";
import { scanMcpConfig } from "../security/scanner";

export const SWITCHBAY_MCP_CONFIG_FILE = "mcp.json";
export type McpServerConfig = {
  enabled?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  allowed_tools?: string[];
  approval?: "auto" | "always";
  timeout_ms?: number;
};

export type SwitchbayMcpIntegration =
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

export type SwitchbayMcpConfig = {
  enabled?: boolean;
  integrations?: SwitchbayMcpIntegration[];
  mcpServers?: Record<string, McpServerConfig>;
};

export type SwitchbayMcpConfigStatus = {
  config: SwitchbayMcpConfig;
  exists: boolean;
  path: string;
  integrations: SwitchbayMcpIntegration[];
};

export function switchbayMcpConfigPath(cwd = process.cwd()): string {
  void cwd;
  const configured = Bun.env.SWITCHBAY_MCP_CONFIG?.trim();
  if (configured) return resolve(configured.replace(/^~/, os.homedir()));
  return userConfigPath(SWITCHBAY_MCP_CONFIG_FILE);
}

export async function loadSwitchbayMcpConfig(cwd = process.cwd()): Promise<SwitchbayMcpConfigStatus> {
  const path = switchbayMcpConfigPath(cwd);
  if (!existsSync(path)) {
    const config = createDefaultSwitchbayMcpConfig();
    return { config, exists: false, path, integrations: resolveSwitchbayMcpIntegrations(config) };
  }

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as SwitchbayMcpConfig;
  return { config: parsed, exists: true, path, integrations: resolveSwitchbayMcpIntegrations(parsed) };
}

export function resolveMcpServerConfigs(config: SwitchbayMcpConfig): Record<string, McpServerConfig> {
  const raw: Record<string, McpServerConfig> = { ...(config.mcpServers ?? {}) };
  for (const integration of config.integrations ?? []) {
    if (typeof integration === "object" && integration.type === "ephemeral_mcp") {
      raw[integration.server_label] = {
        url: integration.server_url,
        headers: integration.headers,
        allowed_tools: integration.allowed_tools,
        approval: "always",
      };
    }
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(raw)) {
    const scan = scanMcpConfig(server);
    if (!scan.safe) {
      // Block unsafe MCP server configs from being loaded
      continue;
    }
    servers[name] = server;
  }
  return servers;
}

export async function saveSwitchbayMcpConfig(config: SwitchbayMcpConfig, cwd = process.cwd()): Promise<string> {
  const path = switchbayMcpConfigPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return path;
}

export function createDefaultSwitchbayMcpConfig(): SwitchbayMcpConfig {
  return {
    enabled: true,
    integrations: [],
    mcpServers: {},
  };
}

export function resolveSwitchbayMcpIntegrations(config: SwitchbayMcpConfig): SwitchbayMcpIntegration[] {
  if (Array.isArray(config.integrations) && config.integrations.length > 0) {
    return config.integrations;
  }

  return Object.keys(config.mcpServers ?? {})
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `mcp/${name}`);
}

export function describeSwitchbayMcpConfig(status: SwitchbayMcpConfigStatus): string {
  const integrations = status.integrations.length
    ? status.integrations.map((item) => `- \`${formatIntegrationLabel(item)}\``).join("\n")
    : "- No integrations configured yet.";

  return [
    "**Switchbay MCP Bridge Configuration**",
    "",
    `Config: \`${status.path}\`${status.exists ? "" : " (not created yet)"}`,
    `Enabled: \`${status.config.enabled === false ? "false" : "true"}\``,
    "",
    "Integrations:",
    integrations,
  ].join("\n");
}

export function buildSwitchbayMcpPromptBlock(
  status: SwitchbayMcpConfigStatus,
  modelLane = "cloud",
): string {
  const integrations = status.integrations.length
    ? status.integrations.map((item) => `- ${formatIntegrationLabel(item)}`).join("\n")
    : "- No MCP integrations configured yet.";

  return [
    "",
    "",
    "SWITCHBAY MCP BRIDGE:",
    `Model lane: ${modelLane}`,
    `Config: ${status.path}${status.exists ? "" : " (not created yet)"}`,
    "Switchbay owns MCP client connections and tool execution for this turn.",
    "Configured stdio and Streamable HTTP servers are initialized; allowed discovered tools are exposed with mcp__server__tool names.",
    "Configured MCP integrations:",
    integrations,
    "",
    "Switchbay MCP bridge rules:",
    "- Use only MCP tools actually present in the model tool list after discovery.",
    "- If a requested server is not configured, fails connection, or exposes no allowed matching tool, say exactly what is missing.",
    "- Do not invent MCP server ids, tool names, plugin handles, or external capabilities.",
  ].join("\n");
}

export function buildCloudMcpPromptBlock(status: SwitchbayMcpConfigStatus): string {
  return buildSwitchbayMcpPromptBlock(status, "cloud");
}

export function formatIntegrationLabel(item: SwitchbayMcpIntegration): string {
  if (typeof item === "string") return item;
  if (item.type === "plugin") return item.id;
  return `${item.server_label} (${item.server_url})`;
}
