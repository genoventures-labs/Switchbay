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

test("parses one-shot query after lane option", () => {
  const parsed = parseCliArgs([
    "bun",
    "index.tsx",
    "--lane",
    "cloud",
    "Reply with one short sentence saying the cloud lane works.",
  ]);
  expect(parsed.subcommand).toBe("run");
  expect(parsed.lane).toBe("cloud");
  expect(parsed.initialQuery).toBe("Reply with one short sentence saying the cloud lane works.");
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

test("parses Memory helper add commands", () => {
  const add = parseCliArgs(["bun", "index.tsx", "memory", "add", "use Bun for tests"]);
  expect(add.subcommand).toBe("memory");
  expect(add.memoryAction).toBe("add");
  expect(add.memoryNote).toBe("use Bun for tests");

  const remember = parseCliArgs(["bun", "index.tsx", "memory", "remember", "prefer local workspaces"]);
  expect(remember.subcommand).toBe("memory");
  expect(remember.memoryAction).toBe("add");
  expect(remember.memoryNote).toBe("prefer local workspaces");
});

test("parses Skills helper commands and keeps toolbox alias", () => {
  const skills = parseCliArgs(["bun", "index.tsx", "skills", "read", "debugging-triage"]);
  expect(skills.subcommand).toBe("skills");
  expect(skills.toolboxAction).toBe("read");
  expect(skills.toolboxSkill).toBe("debugging-triage");

  const toolbox = parseCliArgs(["bun", "index.tsx", "toolbox", "list"]);
  expect(toolbox.subcommand).toBe("toolbox");
  expect(toolbox.toolboxAction).toBe("list");
});

test("parses Plugins helper commands", () => {
  const status = parseCliArgs(["bun", "index.tsx", "plugins"]);
  expect(status.subcommand).toBe("plugins");
  expect(status.pluginAction).toBe("status");

  const list = parseCliArgs(["bun", "index.tsx", "plugins", "list"]);
  expect(list.subcommand).toBe("plugins");
  expect(list.pluginAction).toBe("list");

  const inspect = parseCliArgs(["bun", "index.tsx", "plugins", "inspect", "repo-ops"]);
  expect(inspect.subcommand).toBe("plugins");
  expect(inspect.pluginAction).toBe("inspect");
  expect(inspect.pluginId).toBe("repo-ops");
});

test("parses model helper commands", () => {
  const models = parseCliArgs(["bun", "index.tsx", "models", "--lane", "local"]);
  expect(models.subcommand).toBe("models");
  expect(models.lane).toBe("local");

  const setActiveLane = parseCliArgs(["bun", "index.tsx", "model", "gpt-5.5"]);
  expect(setActiveLane.subcommand).toBe("model");
  expect(setActiveLane.modelTarget).toBe("gpt-5.5");
  expect(setActiveLane.modelLane).toBeNull();

  const setSpecificLane = parseCliArgs(["bun", "index.tsx", "model", "local", "qwen/qwen3-4b-2507"]);
  expect(setSpecificLane.subcommand).toBe("model");
  expect(setSpecificLane.modelLane).toBe("local");
  expect(setSpecificLane.modelTarget).toBe("qwen/qwen3-4b-2507");

  const setFlagLane = parseCliArgs(["bun", "index.tsx", "model", "--lane", "cloud-mcp", "claude-sonnet-4-5"]);
  expect(setFlagLane.subcommand).toBe("model");
  expect(setFlagLane.lane).toBe("cloud-mcp");
  expect(setFlagLane.modelTarget).toBe("claude-sonnet-4-5");
});

test("parses Trace helper commands", () => {
  const last = parseCliArgs(["bun", "index.tsx", "trace"]);
  expect(last.subcommand).toBe("trace");
  expect(last.traceAction).toBe("last");

  const exportTrace = parseCliArgs(["bun", "index.tsx", "trace", "export"]);
  expect(exportTrace.subcommand).toBe("trace");
  expect(exportTrace.traceAction).toBe("export");
});

test("normalizes cloud MCP runtime lane aliases", () => {
  expect(normalizeRuntimeLane("mcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cloud-mcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cloudmcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("cmcp")).toBe("cloud-mcp");
  expect(normalizeRuntimeLane("native-mcp")).toBe("local-mcp");
});
