import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMcpToolRuntime } from "./mcp-client";

const previousConfig = Bun.env.SWITCHBAY_CONFIG_DIR;
let temp = "";
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  if (previousConfig === undefined) delete Bun.env.SWITCHBAY_CONFIG_DIR;
  else Bun.env.SWITCHBAY_CONFIG_DIR = previousConfig;
});

test("discovers and calls a real stdio MCP tool", async () => {
  temp = await mkdtemp(join(tmpdir(), "switchbay-mcp-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = temp;
  await writeFile(join(temp, "mcp.json"), JSON.stringify({
    enabled: true,
    mcpServers: {
      echo: {
        command: process.execPath,
        args: [join(import.meta.dir, "fixtures", "echo-mcp-server.ts")],
        allowed_tools: ["echo"],
        approval: "auto",
      },
    },
  }));

  const runtime = await createMcpToolRuntime(process.cwd());
  try {
    expect(runtime.warnings).toEqual([]);
    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(["mcp__echo__echo"]);
    const result = await runtime.call("mcp__echo__echo", { message: "hello" });
    expect(result.ok).toBe(true);
    expect(result.body).toBe("echo:hello");
  } finally {
    await runtime.close();
  }
});

test("blocks calls unless the configured server explicitly allows auto execution", async () => {
  temp = await mkdtemp(join(tmpdir(), "switchbay-mcp-policy-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = temp;
  await writeFile(join(temp, "mcp.json"), JSON.stringify({
    mcpServers: { echo: { command: process.execPath, args: [join(import.meta.dir, "fixtures", "echo-mcp-server.ts")] } },
  }));
  const runtime = await createMcpToolRuntime(process.cwd());
  try {
    const result = await runtime.call("mcp__echo__echo", { message: "blocked" });
    expect(result.ok).toBe(false);
    expect(result.body).toContain("blocked by Switchbay policy");
  } finally { await runtime.close(); }
});
