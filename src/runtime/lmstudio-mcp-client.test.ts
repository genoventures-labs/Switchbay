import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LmStudioMcpClient } from "./lmstudio-mcp-client";
import { loadLmStudioMcpConfig, resolveLmStudioMcpIntegrations } from "./lmstudio-mcp-config";

const savedEnv = {
  SWITCHBAY_LANE: Bun.env.SWITCHBAY_LANE,
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_LMSTUDIO_API_KEY: Bun.env.SWITCHBAY_LMSTUDIO_API_KEY,
  SWITCHBAY_LMSTUDIO_MCP_CONFIG: Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG,
  SWITCHBAY_LMSTUDIO_MODEL: Bun.env.SWITCHBAY_LMSTUDIO_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("resolves MCP integrations from mcpServers when explicit integrations are absent", () => {
  expect(resolveLmStudioMcpIntegrations({
    mcpServers: {
      playwright: {},
      filesystem: {},
    },
  })).toEqual(["mcp/playwright", "mcp/filesystem"]);
});

test("loads default MCP config when workspace config is missing", async () => {
  Bun.env.SWITCHBAY_LANE = "local-mcp";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "configured-local";
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-mcp-config-"));
  Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG = join(cwd, "lmstudio.mcp.json");

  const status = await loadLmStudioMcpConfig(cwd);

  expect(status.exists).toBe(false);
  expect(status.path).toBe(join(cwd, "lmstudio.mcp.json"));
  expect(status.config.model).toBe("configured-local");
  expect(status.integrations).toEqual([]);
});

test("uses the user config dir for the default MCP config path", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "switchbay-user-config-"));
  delete Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG;
  Bun.env.SWITCHBAY_CONFIG_DIR = configDir;

  const status = await loadLmStudioMcpConfig(await mkdtemp(join(tmpdir(), "switchbay-workspace-")));

  expect(status.exists).toBe(false);
  expect(status.path).toBe(join(configDir, "lmstudio.mcp.json"));
});

test("LM Studio MCP client posts native chat requests with integrations", async () => {
  Bun.env.SWITCHBAY_LANE = "local-mcp";
  Bun.env.SWITCHBAY_LMSTUDIO_API_KEY = "test-local-key";
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-mcp-client-"));
  const configPath = join(cwd, "config", "lmstudio.mcp.json");
  Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG = configPath;
  await writeFile(join(cwd, "package.json"), "{}", "utf-8");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      enabled: true,
      nativeBase: "http://192.168.1.50:1234/api/v1",
      model: "qwen-local",
      integrations: ["mcp/playwright"],
    }),
    "utf-8",
  );

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      id: "chat-test",
      output: [
        { type: "tool_call", tool: "browser_navigate" },
        { type: "message", content: [{ type: "text", text: "Done from MCP." }] },
      ],
    });
  }) as typeof fetch;
  const client = new LmStudioMcpClient({
    cwd,
    fetchImpl,
  });

  const response = await client.createChatCompletion("dev", {
    messages: [
      { role: "system", content: "You are Bay." },
      { role: "user", content: "Use browser tools." },
    ],
  });

  expect(calls[0]?.url).toBe("http://192.168.1.50:1234/api/v1/chat");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer test-local-key");
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(body.model).toBe("qwen-local");
  expect(body.integrations).toEqual(["mcp/playwright"]);
  expect(body.input).toBe("USER: Use browser tools.");
  expect(body.system_prompt).toContain("You are Bay.");
  expect(body.system_prompt).toContain("LM STUDIO MCP LANE");
  expect(body.system_prompt).toContain("Configured integrations: mcp/playwright");
  expect(response.output_text).toBe("Done from MCP.");
  expect(response.meta?.provider).toBe("lmstudio-mcp");
  expect(response.meta?.lmstudio_tool_calls).toEqual(["browser_navigate"]);
});

test("LM Studio MCP client explains missing plugin handles", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-mcp-missing-plugin-"));
  const configPath = join(cwd, "config", "lmstudio.mcp.json");
  Bun.env.SWITCHBAY_LMSTUDIO_MCP_CONFIG = configPath;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      enabled: true,
      nativeBase: "http://192.168.1.50:1234/api/v1",
      model: "qwen-local",
      integrations: ["mcp/playwright"],
    }),
    "utf-8",
  );

  const fetchImpl = (async () =>
    Response.json({
      error: {
        message: "Unable to get plugin tools for 'mcp/playwright'. Error: Cannot find plugin handle for plugin: mcp/playwright",
        type: "plugin_connection_error",
        param: "integrations",
      },
    }, { status: 400 })) as unknown as typeof fetch;

  const client = new LmStudioMcpClient({ cwd, fetchImpl });

  await expect(client.createChatCompletion("dev", {
    messages: [{ role: "user", content: "Use MCP tools." }],
  })).rejects.toThrow("could not find MCP plugin `mcp/playwright`");
});
