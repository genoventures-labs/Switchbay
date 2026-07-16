import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "./types";
import { loadSwitchbayMcpConfig, resolveMcpServerConfigs, type McpServerConfig } from "./mcp-config";
import { SWITCHBAY_VERSION } from "../version";

type ConnectedServer = { id: string; config: McpServerConfig; client: Client; tools: Map<string, string> };

export type McpToolRuntime = {
  tools: ToolDefinition[];
  warnings: string[];
  owns(name: string): boolean;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; body: string; summary: string }>;
  close(): Promise<void>;
};

export async function createMcpToolRuntime(cwd: string): Promise<McpToolRuntime> {
  const status = await loadSwitchbayMcpConfig(cwd);
  if (status.config.enabled === false) return emptyRuntime([]);
  const connected: ConnectedServer[] = [];
  const definitions: ToolDefinition[] = [];
  const warnings: string[] = [];

  for (const [id, config] of Object.entries(resolveMcpServerConfigs(status.config))) {
    if (config.enabled === false) continue;
    try {
      validateServerConfig(id, config);
      const client = new Client({ name: "switchbay", version: SWITCHBAY_VERSION }, { capabilities: {} });
      const transport = config.url
        ? new StreamableHTTPClientTransport(new URL(expandEnv(config.url)), {
            requestInit: { headers: expandRecord(config.headers) },
          })
        : new StdioClientTransport({
            command: expandEnv(config.command!),
            args: (config.args ?? []).map(expandEnv),
            cwd: config.cwd ? expandEnv(config.cwd) : cwd,
            env: { ...process.env, ...expandRecord(config.env) } as Record<string, string>,
            stderr: "pipe",
          });
      const timeout = boundedTimeout(config.timeout_ms);
      await client.connect(transport, { timeout });
      const listed = await client.listTools(undefined, { timeout });
      const reverse = new Map<string, string>();
      const allowed = config.allowed_tools?.length ? new Set(config.allowed_tools) : null;
      for (const tool of listed.tools) {
        if (allowed && !allowed.has(tool.name)) continue;
        const exposed = `mcp__${slug(id)}__${slug(tool.name)}`;
        reverse.set(exposed, tool.name);
        definitions.push({
          type: "function",
          function: {
            name: exposed,
            description: `[External MCP: ${id}] ${tool.description ?? tool.name}. Execution policy: ${config.approval ?? "always"}.`,
            parameters: tool.inputSchema as Record<string, unknown>,
          },
        });
      }
      connected.push({ id, config, client, tools: reverse });
    } catch (error) {
      warnings.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    tools: definitions,
    warnings,
    owns: (name) => connected.some((server) => server.tools.has(name)),
    async call(name, args, signal) {
      const server = connected.find((entry) => entry.tools.has(name));
      if (!server) return { ok: false, summary: `Unknown MCP tool ${name}`, body: `MCP tool not found: ${name}` };
      const remoteName = server.tools.get(name)!;
      if (server.config.approval !== "auto") {
        return {
          ok: false,
          summary: `MCP approval required: ${server.id}.${remoteName}`,
          body: `External MCP call blocked by Switchbay policy. Set approval to "auto" for server "${server.id}" after reviewing its tools and trust boundary.`,
        };
      }
      try {
        const result = await server.client.callTool({ name: remoteName, arguments: args }, undefined, {
          signal,
          timeout: boundedTimeout(server.config.timeout_ms),
        });
        return {
          ok: result.isError !== true,
          summary: `Called MCP ${server.id}.${remoteName}`,
          body: normalizeMcpContent(result).slice(0, 50_000),
        };
      } catch (error) {
        return { ok: false, summary: `MCP ${server.id}.${remoteName} failed`, body: error instanceof Error ? error.message : String(error) };
      }
    },
    async close() { await Promise.allSettled(connected.map((server) => server.client.close())); },
  };
}

function emptyRuntime(warnings: string[]): McpToolRuntime {
  return { tools: [], warnings, owns: () => false, call: async () => ({ ok: false, summary: "MCP unavailable", body: "MCP unavailable" }), close: async () => {} };
}

function validateServerConfig(id: string, config: McpServerConfig): void {
  if (!!config.url === !!config.command) throw new Error(`MCP server ${id} must define exactly one of url or command.`);
  if (config.url) {
    const url = new URL(expandEnv(config.url));
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Remote MCP URLs must use HTTPS; HTTP is allowed only on loopback.");
  }
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, key) => Bun.env[key] ?? "");
}
function expandRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, expandEnv(value)]));
}
function boundedTimeout(value?: number): number { return Math.max(1_000, Math.min(120_000, Number(value) || 30_000)); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48); }
function normalizeMcpContent(result: Record<string, unknown>): string {
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2);
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = content.map((item: any) => item?.type === "text" ? item.text : item?.type === "resource" ? JSON.stringify(item.resource, null, 2) : item?.type ? `[${item.type} content]` : JSON.stringify(item));
  return parts.filter(Boolean).join("\n\n") || "MCP tool completed without text output.";
}
