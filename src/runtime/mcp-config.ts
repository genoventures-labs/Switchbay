import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { userConfigPath } from "../config/paths";

export const SWITCHBAY_MCP_CONFIG_FILE = "mcp.json";
export const LEGACY_MCP_CONFIG_FILE = "lmstudio.mcp.json";

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
  mcpServers?: Record<string, unknown>;
};

export type SwitchbayMcpConfigStatus = {
  config: SwitchbayMcpConfig;
  exists: boolean;
  path: string;
  integrations: SwitchbayMcpIntegration[];
};

export function switchbayMcpConfigPath(cwd = process.cwd()): string {
  void cwd;
  const configured = Bun.env.SWITCHBAY_MCP_CONFIG?.trim() || Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG?.trim();
  if (configured) return resolve(configured.replace(/^~/, os.homedir()));
  return userConfigPath(SWITCHBAY_MCP_CONFIG_FILE);
}

export async function loadSwitchbayMcpConfig(cwd = process.cwd()): Promise<SwitchbayMcpConfigStatus> {
  const path = switchbayMcpConfigPath(cwd);
  if (!existsSync(path)) {
    const legacyPath = userConfigPath(LEGACY_MCP_CONFIG_FILE);
    if (existsSync(legacyPath)) {
      try {
        const raw = await readFile(legacyPath, "utf-8");
        const parsed = JSON.parse(raw) as SwitchbayMcpConfig;
        return { config: parsed, exists: true, path: legacyPath, integrations: resolveSwitchbayMcpIntegrations(parsed) };
      } catch {
        // Fall through to defaults
      }
    }
    const config = createDefaultSwitchbayMcpConfig();
    return { config, exists: false, path, integrations: resolveSwitchbayMcpIntegrations(config) };
  }

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as SwitchbayMcpConfig;
  return { config: parsed, exists: true, path, integrations: resolveSwitchbayMcpIntegrations(parsed) };
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
    "Switchbay owns MCP/tool execution for this turn.",
    "Use Switchbay's local tool bridge for tool execution and treat configured MCP integrations as allowed tool intent.",
    "Configured MCP integrations:",
    integrations,
    "",
    "Switchbay MCP bridge rules:",
    "- If the user asks for configured MCP/browser/file/fetch behavior, use the matching Switchbay tool calls when available.",
    "- If a requested MCP server is not configured or no matching Switchbay bridge tool exists, say exactly what is missing.",
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
