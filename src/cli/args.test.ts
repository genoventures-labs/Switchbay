import { expect, test } from "bun:test";
import { parseCliArgs } from "./args";

test("parses MCP CLI helper commands", () => {
  const status = parseCliArgs(["bun", "index.tsx", "mcp"]);
  expect(status.subcommand).toBe("mcp");
  expect(status.mcpAction).toBe("status");

  const init = parseCliArgs(["bun", "index.tsx", "mcp", "init"]);
  expect(init.subcommand).toBe("mcp");
  expect(init.mcpAction).toBe("init");

  const catalog = parseCliArgs(["bun", "index.tsx", "mcp", "catalog"]);
  expect(catalog.subcommand).toBe("mcp");
  expect(catalog.mcpAction).toBe("catalog");
});

test("parses MCP runtime lane aliases", () => {
  const parsed = parseCliArgs(["bun", "index.tsx", "--lane", "mcp", "hello"]);
  expect(parsed.subcommand).toBe("run");
  expect(parsed.lane).toBe("mcp");
  expect(parsed.initialQuery).toBe("hello");
});
