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
    "**LM Studio Native MCP Lane (legacy/experimental)**",
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
      ? "Use `/lane native-mcp` to test LM Studio's native MCP chat API. Use `/mcp on` for Switchbay's own bridge."
      : "Add LM Studio-installed MCP server ids like `mcp/<server-label>` to `integrations`, then use `/lane native-mcp`.",
  ].join("\n");
}

export function buildSwitchbayMcpPromptBlock(
  status: LmStudioMcpConfigStatus,
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
    "Switchbay owns MCP/tool execution for this turn. Do not call LM Studio's native MCP chat API unless the runtime lane is explicitly local-mcp.",
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

export function buildCloudMcpPromptBlock(status: LmStudioMcpConfigStatus): string {
  return buildSwitchbayMcpPromptBlock(status, "cloud");
}

export function formatIntegrationLabel(item: LmStudioMcpIntegration): string {
  if (typeof item === "string") return item;
  if (item.type === "plugin") return item.id;
  return `${item.server_label} (${item.server_url})`;
}
