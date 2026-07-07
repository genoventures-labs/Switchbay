import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceStorageDir } from "../config/paths";
import { LmStudioMcpClient } from "./lmstudio-mcp-client";
import { loadLmStudioMcpConfig, resolveLmStudioMcpIntegrations } from "./lmstudio-mcp-config";

const savedEnv = {
  SWITCHBAY_LANE: Bun.env.SWITCHBAY_LANE,
  SWITCHBAY_LMSTUDIO_API_KEY: Bun.env.SWITCHBAY_LMSTUDIO_API_KEY,
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

  const status = await loadLmStudioMcpConfig(cwd);

  expect(status.exists).toBe(false);
  expect(status.config.model).toBe("configured-local");
  expect(status.integrations).toEqual(["mcp/playwright"]);
});

test("LM Studio MCP client posts native chat requests with integrations", async () => {
  Bun.env.SWITCHBAY_LANE = "local-mcp";
  Bun.env.SWITCHBAY_LMSTUDIO_API_KEY = "test-local-key";
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-mcp-client-"));
  await writeFile(join(cwd, "package.json"), "{}", "utf-8");
  await mkdir(workspaceStorageDir(cwd), { recursive: true });
  await writeFile(
    join(workspaceStorageDir(cwd), "lmstudio.mcp.json"),
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
  expect(response.output_text).toBe("Done from MCP.");
  expect(response.meta?.provider).toBe("lmstudio-mcp");
  expect(response.meta?.lmstudio_tool_calls).toEqual(["browser_navigate"]);
});
