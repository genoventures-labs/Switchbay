import { expect, test } from "bun:test";
import { normalizeRuntimeLane } from "../config/env";
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

test("parses Workspace Knowledge helper commands", () => {
  const status = parseCliArgs(["bun", "index.tsx", "knowledge"]);
  expect(status.subcommand).toBe("knowledge");
  expect(status.knowledgeAction).toBe("status");

  const refresh = parseCliArgs(["bun", "index.tsx", "index", "refresh"]);
  expect(refresh.subcommand).toBe("knowledge");
  expect(refresh.knowledgeAction).toBe("refresh");

  const search = parseCliArgs(["bun", "index.tsx", "knowledge", "search", "approval", "gates"]);
  expect(search.subcommand).toBe("knowledge");
  expect(search.knowledgeAction).toBe("search");
  expect(search.knowledgeQuery).toBe("approval gates");
});

test("normalizes cloud MCP runtime lane aliases", () => {
  expect(normalizeRuntimeLane("mcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cloud-mcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cloudmcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cmcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("native-mcp")).toBe("local-mcp");
});
