import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import type { ChatRuntimeClient } from "../runtime/client";
import type { ChatCompletionRequest, ChatCompletionResponse, ToolCall } from "../runtime/types";
import { executeToolCall } from "./tools";
import { refreshKnowledgeIndex } from "../knowledge/store";
import { invalidateConfigCache } from "../config/switchbay-config";
import {
  buildTurn,
  executeTurn,
  extractAssistantText,
  generateEngineManifest,
  generateSwitchbayMcpConfig,
  generatePluginDefinition,
  generateRuleDefinition,
  generateSkillDefinition,
  synthesizeAssistantFallback,
} from "./loop";
import { parseApprovalIntent, tryLocalCommand } from "./commands";
import type { BuiltTurn } from "./loop";

function createResponse(content: unknown, toolCalls?: ToolCall[]): ChatCompletionResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}

function createTurn(): BuiltTurn {
  return {
    mode: "build",
    objective: "test",
    pendingPlan: [],
    resolvedProfile: "switchbay",
    request: {
      messages: [{ role: "user", content: "test" }],
    },
  };
}

function createMockClient(responses: ChatCompletionResponse[]) {
  const calls: ChatCompletionRequest[] = [];
  const client = {
    async createChatCompletion(
      _surface: string,
      request: ChatCompletionRequest,
    ): Promise<ChatCompletionResponse> {
      calls.push(request);
      const response = responses.shift();
      if (!response) throw new Error("No mock response queued.");
      return response;
    },
  } as Pick<ChatRuntimeClient, "createChatCompletion">;

  return { client, calls };
}

test("approval intent accepts short apply and cancel inputs", () => {
  expect(parseApprovalIntent("y")).toBe("apply");
  expect(parseApprovalIntent("2")).toBe("apply");
  expect(parseApprovalIntent("n")).toBe("cancel");
  expect(parseApprovalIntent("1")).toBe("cancel");
  expect(parseApprovalIntent("3")).toBe("always");
  expect(parseApprovalIntent("yes always")).toBe("always");
  expect(parseApprovalIntent("apply")).toBeNull();
  expect(parseApprovalIntent("/cancel")).toBeNull();
  expect(parseApprovalIntent("later")).toBeNull();
});

test("generateEngineManifest produces a workspace engine draft", async () => {
  const { client } = createMockClient([
    createResponse(`\`\`\`json
{
  "id": "file-helper",
  "name": "File Helper",
  "description": "Inspect and summarize files.",
  "cwd": ".",
  "tools": [
    {
      "name": "list_files",
      "description": "List files under a path.",
      "command": "find {{path}} -maxdepth 2 -type f",
      "parameters": {
        "path": { "type": "string", "description": "Directory path." }
      },
      "required": ["path"],
      "approval": "auto"
    }
  ]
}
\`\`\``),
  ]);

  const draft = await generateEngineManifest(client, "dev", {
    name: "File Helper",
    purpose: "Help with file inspection.",
    tools: "list files",
    commands: "find {{path}} -maxdepth 2 -type f",
    approval: "read-only",
  });

  expect(draft.id).toBe("file-helper");
  expect(draft.name).toBe("File Helper");
  expect(draft.savePath).toContain("Switchbay Engines/engines/Shell/FileHelper/file_helper.engine.json");
  expect(JSON.parse(draft.content).tools[0].name).toBe("list_files");
});

test("generateSkillDefinition produces a workspace Toolbox skill draft", async () => {
  const { client } = createMockClient([
    createResponse(`---
id: launch-check
name: Launch Check
description: Check release readiness.
languages: [any]
agents: [any]
tags: [release]
triggers: [launch, release]
---

# Launch Check

## Use When

- Before a release.

## Method

1. Check tests.
`),
  ]);

  const draft = await generateSkillDefinition(client, "dev", {
    name: "Launch Check",
    purpose: "Check release readiness.",
    triggers: "launch, release",
    method: "Check tests.",
    guardrails: "Do not publish without approval.",
  });

  expect(draft.id).toBe("launch-check");
  expect(draft.savePath).toContain("Engine Toolboxes/skills/launch-check.skill.md");
  expect(draft.content).toContain("id: launch-check");
});

test("generatePluginDefinition produces a bounded workspace plugin manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-plugin-draft-"));
  const previous = Bun.env.SWITCHBAY_PLUGIN_AUTHORING_PATH;
  Bun.env.SWITCHBAY_PLUGIN_AUTHORING_PATH = cwd;
  const draft = await generatePluginDefinition({
    name: "Repo Ops",
    purpose: "Bundle repo hygiene agents and skills.",
    contents: "agents, skills, engines",
    notes: "Local workspace only.",
  }, cwd).finally(() => {
    if (previous === undefined) delete Bun.env.SWITCHBAY_PLUGIN_AUTHORING_PATH;
    else Bun.env.SWITCHBAY_PLUGIN_AUTHORING_PATH = previous;
  });

  const manifest = JSON.parse(draft.content);
  expect(draft.id).toBe("repo-ops");
  expect(draft.savePath).toBe(join(cwd, "plugins", "repo-ops", "plugin.json"));
  expect(manifest.enabled).toBe(true);
  expect(manifest.agents).toEqual([]);
  expect(manifest.skills).toEqual([]);
  expect(manifest.engines).toEqual([]);
  expect(manifest.guides).toEqual([]);
});

test("generateRuleDefinition produces a user rule draft", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-rule-draft-"));
  const previous = Bun.env.SWITCHBAY_CONFIG_DIR;
  Bun.env.SWITCHBAY_CONFIG_DIR = join(cwd, "user-config");

  try {
    const draft = await generateRuleDefinition({
      name: "Spreadsheet Edits",
      trigger: "spreadsheet, csv, sheets",
      rule: "Read the quick start before editing sheets.\nNever overwrite formulas without calling it out.",
      appliesTo: "Spreadsheet and CSV editing tasks.",
      scope: "global",
    }, cwd);

    expect(draft.id).toBe("spreadsheet-edits");
    expect(draft.savePath).toBe(join(cwd, "user-config", "rules", "spreadsheet-edits.rule.md"));
    expect(draft.content).toContain("triggers: [spreadsheet, csv, sheets]");
    expect(draft.content).toContain("Never overwrite formulas");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_CONFIG_DIR;
    } else {
      Bun.env.SWITCHBAY_CONFIG_DIR = previous;
    }
  }
});

test("generateSwitchbayMcpConfig produces a user MCP config draft", async () => {
  const { client } = createMockClient([
    createResponse(`{
  "enabled": true,
  "integrations": ["mcp/playwright"],
  "mcpServers": {
    "playwright": { "note": "Already configured on the external MCP server." }
  }
}`),
  ]);
  const previous = Bun.env.SWITCHBAY_MCP_CONFIG;
  const configPath = join(await mkdtemp(join(tmpdir(), "switchbay-mcp-draft-")), "mcp.json");
  Bun.env.SWITCHBAY_MCP_CONFIG = configPath;

  try {
    const draft = await generateSwitchbayMcpConfig(client, "dev", {
      name: "Browser MCP",
      purpose: "Let local models use browser tools.",
      servers: "playwright",
      integrations: "mcp/playwright",
      notes: "Use http://192.168.1.50:1234.",
    });

    expect(draft.id).toBe("mcp");
    expect(draft.savePath).toBe(configPath);
    const parsed = JSON.parse(draft.content);
    expect(parsed.integrations).toEqual(["mcp/playwright"]);
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_MCP_CONFIG;
    } else {
      Bun.env.SWITCHBAY_MCP_CONFIG = previous;
    }
  }
});

test("generateSwitchbayMcpConfig refuses unknown MCP servers", async () => {
  const { client } = createMockClient([]);

  await expect(generateSwitchbayMcpConfig(client, "dev", {
    name: "Mystery MCP",
    purpose: "Use a custom imaginary accounting server.",
    servers: "dragon-saddle",
    integrations: "mcp/dragon-saddle",
    notes: "",
  })).rejects.toThrow("Switchbay will not invent MCP server ids");
});

test("tool fallback returns the first useful tool body", () => {
  const fallback = synthesizeAssistantFallback("status?", [
    { tool: "git_status", ok: true, summary: "status", body: "Working tree clean." },
  ]);

  expect(fallback).toBe("Working tree clean.");
});

test("model-tool registry describes native tools and specialist resources", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-model-tool-registry-"));
  const listed = await executeToolCall("list_model_tools", {}, { cwd });
  expect(listed.ok).toBe(true);
  expect(listed.body).toContain("workspace_hop\tworkspace\twrite");
  expect(listed.body).toContain("git_push\tgit\tapproval");
  expect(listed.body).toContain("usage_cost_summary\ttelemetry\tread");

  const described = await executeToolCall("describe_model_tool", { name: "read_agent" }, { cwd });
  expect(described.body).toContain('"category": "agents"');
  expect(described.body).toContain('"policy": "read"');

  const agent = await executeToolCall("read_agent", { id: "backend" }, { cwd });
  expect(agent.ok).toBe(true);
  expect(agent.body).toContain("Backend Engineer");

  const guide = await executeToolCall("read_guide", { id: "tool-use-quick-start" }, { cwd });
  expect(guide.ok).toBe(true);
  expect(guide.body).toContain("Read files and list directories");
});

test("executeTurn returns a text-only response without tool work", async () => {
  const { client, calls } = createMockClient([createResponse("Plain answer.")]);
  const steps: string[] = [];

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
    onStep: (step) => steps.push(step),
  });

  expect(extractAssistantText(result.response)).toBe("Plain answer.");
  expect(result.toolExecutions).toHaveLength(0);
  expect(calls).toHaveLength(1);
  expect(steps.at(-1)).toBe("Done.");
});

test("executeTurn replays provider continuation without executing managed events locally", async () => {
  const providerContent = [{ type: "server_tool_use", id: "srv-1", name: "web_search", input: { query: "Switchbay" } }];
  const { client, calls } = createMockClient([
    {
      choices: [{ message: { role: "assistant", content: "", provider_content: providerContent }, finish_reason: "pause_turn" }],
      provider: {
        events: [{ provider: "anthropic", type: "server_tool_use", name: "web_search", server_managed: true, status: "paused" }],
        citations: [],
        artifacts: [],
        continuation: { provider: "anthropic", kind: "pause_turn", state: providerContent },
      },
    },
    createResponse("Search complete."),
  ]);

  const result = await executeTurn({ client: client as ChatRuntimeClient, sessionId: "provider-continuation", surface: "dev", turn: createTurn() });

  expect(extractAssistantText(result.response)).toBe("Search complete.");
  expect(result.toolExecutions).toHaveLength(0);
  expect(result.providerEvents).toHaveLength(1);
  expect(calls[1]?.messages.at(-1)?.provider_content).toEqual(providerContent);
});

test("buildTurn injects Toolbox skills into system context", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-toolbox-context-"));
  const turn = await buildTurn({
    input: "review this change",
    mode: "build",
    previousObjective: null,
    profile: "switchbay",
    transcript: [],
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });

  const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";
  expect(system).toContain("TOOLBOX SKILLS");
  expect(system).toContain("CAPABILITY DIRECTORY");
  expect(system).toContain("Agents:");
  expect(system).toContain("Engines:");
  expect(system).toContain("Plugins:");
  expect(system).toContain("MCP Integrations:");
  expect(system).toContain("Using: agent/<id> · skill/<id> · engine/<id> · plugin/<id> · mcp/<id>");
  expect(system).toContain("code-review-pass");
  expect(system).toContain("QUICK GUIDE DIRECTORY");
  expect(system).toContain("tool-use-quick-start");
  expect(system).toContain("Using: guide/<id>");
  const guideIndex = await readFile(join(cwd, ".switchbay", "runtime", "guides", "INDEX.md"), "utf-8");
  expect(guideIndex).toContain("Tool Use Quick Start");
  expect(await readFile(join(cwd, ".switchbay", "runtime", "guides", "tool-use-quick-start.quickstart.md"), "utf-8")).toContain("Read files and list directories");
  const modelToolsGuide = await readFile(join(cwd, ".switchbay", "runtime", "guides", "model-tools-quick-start.quickstart.md"), "utf-8");
  expect(modelToolsGuide).toContain("list_model_tools");
  expect(modelToolsGuide).toContain("workspace_hop");
  expect(modelToolsGuide).toContain("mcp__<server>__<tool>");
});

test("buildTurn gives Gumroad reporting an explicit date-range rule", async () => {
  const turn = await buildTurn({
    input: "weekly Gumroad stats",
    mode: "build",
    profile: "switchbay",
    previousObjective: null,
    transcript: [],
    workspace: null,
  });
  const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";

  expect(system).toContain("Current Local Date:");
  expect(system).toContain("gumroad_sales_range");
  expect(system).toContain("ask which date range they mean");
});

test("buildTurn injects Workspace Knowledge hits into system context", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-knowledge-context-"));
  await writeFile(
    join(cwd, "architecture.md"),
    "# Architecture\n\nApproval gates live in the terminal control layer and protect risky shell actions.\n",
    "utf-8",
  );
  await refreshKnowledgeIndex(cwd);

  const turn = await buildTurn({
    input: "where are approval gates described?",
    mode: "build",
    previousObjective: null,
    profile: "switchbay",
    transcript: [],
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });

  const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";
  // Knowledge is on-demand via the memory-helper engine, not pre-loaded into the system prompt.
  expect(system).not.toContain("WORKSPACE KNOWLEDGE MAP");
  expect(turn.contextReceipt?.some((r) => r.startsWith("memory:on-demand"))).toBe(true);
});

test("buildTurn injects Switchbay MCP guidance for cloud-mcp lane", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-cloud-mcp-context-"));
  const previous = Bun.env.SWITCHBAY_CONFIG_DIR;
  Bun.env.SWITCHBAY_CONFIG_DIR = join(cwd, "user-config");

  try {
    const turn = await buildTurn({
      input: "use browser MCP tools",
      mode: "build",
      previousObjective: null,
      profile: "switchbay",
      runtimeLane: "cloud-mcp",
      transcript: [],
      workspace: {
        cwd,
        repoRoot: cwd,
        branch: null,
        dirtyFiles: [],
        recentFiles: [],
        diff: { hasChanges: false, stat: "" },
      },
    });

    const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("Runtime Lane: cloud-mcp");
    expect(system).toContain("SWITCHBAY MCP BRIDGE");
    expect(system).toContain("Model lane: cloud-mcp");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_CONFIG_DIR;
    } else {
      Bun.env.SWITCHBAY_CONFIG_DIR = previous;
    }
  }
});

test("buildTurn injects Switchbay MCP guidance for local lane tool mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-local-mcp-bridge-context-"));
  const previous = Bun.env.SWITCHBAY_CONFIG_DIR;
  Bun.env.SWITCHBAY_CONFIG_DIR = join(cwd, "user-config");

  try {
    const turn = await buildTurn({
      input: "use local MCP bridge tools",
      mode: "build",
      previousObjective: null,
      profile: "switchbay",
      runtimeLane: "local",
      toolMode: "switchbay-mcp",
      transcript: [],
      workspace: {
        cwd,
        repoRoot: cwd,
        branch: null,
        dirtyFiles: [],
        recentFiles: [],
        diff: { hasChanges: false, stat: "" },
      },
    });

    const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("Runtime Lane: local");
    expect(system).toContain("Tool Mode: switchbay-mcp");
    expect(system).toContain("SWITCHBAY MCP BRIDGE");
    expect(system).toContain("Model lane: local");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_CONFIG_DIR;
    } else {
      Bun.env.SWITCHBAY_CONFIG_DIR = previous;
    }
  }
});

test("operational memory commands save, refresh, and inject context", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-memory-"));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "memory-demo", scripts: { test: "bun test" } }), "utf-8");

  const remembered = await tryLocalCommand("/remember use Bun for tests", {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });
  expect(remembered.handled).toBe(true);
  expect(remembered.assistantMessage).toContain("Remembered");

  const refreshed = await tryLocalCommand("/memory refresh", {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });
  expect(refreshed.handled).toBe(true);
  expect(refreshed.assistantMessage).toContain("Operational Memory");

  const tool = await executeToolCall("memory_facts", {}, { cwd });
  expect(tool.ok).toBe(true);
  expect(tool.body).toContain("package.name: memory-demo");

  const turn = await buildTurn({
    input: "what should you remember?",
    mode: "build",
    previousObjective: null,
    profile: "switchbay",
    transcript: [],
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });
  const system = turn.request.messages.find((message) => message.role === "system")?.content ?? "";
  // Memory is on-demand via the memory-helper engine, not pre-loaded into the system prompt.
  expect(system).not.toContain("OPERATIONAL MEMORY");
  expect(turn.contextReceipt?.some((r) => r.startsWith("memory:on-demand"))).toBe(true);
});

test("executeTurn feeds native tool results back into the next model call", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-loop-tool-"));
  await writeFile(join(cwd, "demo.txt"), "file body\n", "utf-8");
  const { client, calls } = createMockClient([
    createResponse("Let me inspect the file.", [
      {
        id: "call-read",
        type: "function",
        function: { name: "read_file", arguments: JSON.stringify({ path: "demo.txt" }) },
      },
    ]),
    createResponse("Read complete."),
  ]);
  let streamResets = 0;
  let actionDraft = "";

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
    onStreamReset: (draft) => { streamResets += 1; actionDraft = draft; },
  });

  expect(result.toolExecutions).toHaveLength(1);
  expect(result.toolExecutions[0]?.body).toBe("file body\n");
  expect(extractAssistantText(result.response)).toBe("Read complete.");
  expect(calls).toHaveLength(2);
  expect(streamResets).toBe(1);
  expect(actionDraft).toBe("Let me inspect the file.");
  expect(calls[1]?.messages.some((message) => message.role === "tool" && message.content === "file body\n")).toBe(true);
});

test("executeTurn workspace hop changes cwd for later tools in the same turn", async () => {
  const originalCwd = process.cwd();
  const previousConfigDir = Bun.env.SWITCHBAY_CONFIG_DIR;
  const configDir = await mkdtemp(join(tmpdir(), "switchbay-hop-tool-config-"));
  const source = await mkdtemp(join(tmpdir(), "switchbay-hop-source-"));
  const target = await mkdtemp(join(tmpdir(), "BillTend-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = configDir;
  await writeFile(join(configDir, "config.json"), JSON.stringify({ locations: [target], auto_discover: false }));
  await writeFile(join(target, "package.json"), JSON.stringify({ name: "billtend", version: "1.0.0" }));
  invalidateConfigCache();
  const { client } = createMockClient([
    createResponse(null, [
      { id: "call-hop", type: "function", function: { name: "workspace_hop", arguments: JSON.stringify({ query: "BillTend" }) } },
      { id: "call-package", type: "function", function: { name: "read_json", arguments: JSON.stringify({ path: "package.json" }) } },
    ]),
    createResponse("BillTend loaded."),
  ]);

  try {
    process.chdir(source);
    const result = await executeTurn({ client: client as ChatRuntimeClient, cwd: source, sessionId: "test-session", surface: "dev", turn: createTurn() });
    expect(result.toolExecutions[0]?.travel?.toPath).toBe(target);
    expect(result.toolExecutions[1]?.body).toContain('"name": "billtend"');
  } finally {
    process.chdir(originalCwd);
    invalidateConfigCache();
    if (previousConfigDir === undefined) delete Bun.env.SWITCHBAY_CONFIG_DIR;
    else Bun.env.SWITCHBAY_CONFIG_DIR = previousConfigDir;
  }
});

test("workspace_hop can enter an explicitly requested adjacent non-git directory", async () => {
  const originalCwd = process.cwd();
  const parent = await mkdtemp(join(tmpdir(), "switchbay-adjacent-"));
  const source = join(parent, "Switchbay Engines");
  const target = join(parent, "Adjacent Project Fixture");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  try {
    const result = await executeToolCall("workspace_hop", { query: "AdjacentProjectFixture" }, { cwd: source });
    expect(result.ok).toBe(true);
    expect(result.travel?.toPath).toBe(target);
  } finally { process.chdir(originalCwd); }
});

test("executeTurn fails closed after an unresolved grounding tool failure", async () => {
  const { client } = createMockClient([
    createResponse(null, [{ id: "bad-hop", type: "function", function: { name: "workspace_hop", arguments: JSON.stringify({ query: "definitely-not-a-workspace" }) } }]),
    createResponse("Here is a confident but fabricated repository summary."),
  ]);
  const result = await executeTurn({ client: client as ChatRuntimeClient, cwd: process.cwd(), sessionId: "test-session", surface: "dev", turn: createTurn() });
  const answer = extractAssistantText(result.response);
  expect(answer).toContain("I couldn't ground this request");
  expect(answer).toContain("stopped rather than inventing");
  expect(answer).not.toContain("confident but fabricated");
});

test("executeTurn discovers and executes configured external MCP tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-loop-mcp-"));
  const previousConfigDir = Bun.env.SWITCHBAY_CONFIG_DIR;
  Bun.env.SWITCHBAY_CONFIG_DIR = cwd;
  await writeFile(join(cwd, "mcp.json"), JSON.stringify({
    mcpServers: {
      echo: {
        command: process.execPath,
        args: [join(import.meta.dir, "..", "runtime", "fixtures", "echo-mcp-server.ts")],
        allowed_tools: ["echo"],
        approval: "auto",
      },
    },
  }));
  const { client, calls } = createMockClient([
    createResponse(null, [{
      id: "call-mcp-echo",
      type: "function",
      function: { name: "mcp__echo__echo", arguments: JSON.stringify({ message: "from-loop" }) },
    }]),
    createResponse("External MCP complete."),
  ]);

  try {
    const turn = createTurn();
    turn.toolMode = "switchbay-mcp";
    const result = await executeTurn({ client: client as ChatRuntimeClient, cwd, sessionId: "test-session", surface: "dev", turn });
    expect(result.toolExecutions[0]?.body).toBe("echo:from-loop");
    expect(calls[0]?.tools?.some((tool) => tool.function.name === "mcp__echo__echo")).toBe(true);
    expect(calls[1]?.messages.some((message) => message.role === "tool" && message.content === "echo:from-loop")).toBe(true);
  } finally {
    if (previousConfigDir === undefined) delete Bun.env.SWITCHBAY_CONFIG_DIR;
    else Bun.env.SWITCHBAY_CONFIG_DIR = previousConfigDir;
  }
});

test("executeTurn retries one empty non-tool response", async () => {
  const { client, calls } = createMockClient([
    createResponse(""),
    createResponse("Recovered."),
  ]);
  const steps: string[] = [];

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
    onStep: (step) => steps.push(step),
  });

  expect(extractAssistantText(result.response)).toBe("Recovered.");
  expect(calls).toHaveLength(2);
  expect(calls[1]?.messages.at(-1)?.content).toContain("previous reply was empty");
  expect(steps).toContain("retrying empty reply...");
});

test("executeTurn returns a checkpoint summary when tool steps hit the limit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-step-limit-"));
  await writeFile(join(cwd, "demo.txt"), "file body\n", "utf-8");
  const readCall = (id: string): ToolCall => ({
    id,
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "demo.txt" }) },
  });
  const { client } = createMockClient([
    createResponse(null, [readCall("call-read-1")]),
    createResponse(null, [readCall("call-read-2")]),
  ]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
    maxIterations: 2,
  });

  const text = extractAssistantText(result.response);
  expect(result.toolExecutions).toHaveLength(2);
  expect(text).toContain("Switchbay paused after 2 tool steps");
  expect(text).toContain("Recent completed work:");
  expect(text).toContain("Say `continue`");
});

test("executeTurn ignores malformed inline tool call markup", async () => {
  const malformed = "Before <tool_call>{bad json</tool_call> after";
  const { client } = createMockClient([createResponse(malformed)]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions).toHaveLength(0);
  expect(extractAssistantText(result.response)).toBe(malformed);
});

test("executeTurn rejects truncated native tool arguments before filesystem execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-truncated-tool-"));
  const truncated = createResponse(null, [{
    id: "call-write",
    type: "function",
    function: {
      name: "write_file",
      arguments: '{"path":"large.py","content":"unterminated',
    },
  }]);
  const truncatedChoice = truncated.choices?.[0];
  if (!truncatedChoice) throw new Error("Expected a mock response choice.");
  truncatedChoice.finish_reason = "max_tokens";
  const { client, calls } = createMockClient([truncated, createResponse("Retried safely.")]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions).toHaveLength(1);
  expect(result.toolExecutions[0]?.ok).toBe(false);
  expect(result.toolExecutions[0]?.body).toContain("truncated before execution");
  expect(await Bun.file(join(cwd, "large.py")).exists()).toBe(false);
  expect(calls[1]?.messages.at(-1)?.content).toContain("Reissue one tool call");
  expect(extractAssistantText(result.response)).toBe("Retried safely.");
});

test("executeTurn rejects missing required tool parameters before execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-missing-tool-"));
  const { client } = createMockClient([
    createResponse(null, [{
      id: "call-create",
      type: "function",
      function: { name: "create_file", arguments: "{}" },
    }]),
    createResponse("Corrected."),
  ]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions[0]?.ok).toBe(false);
  expect(result.toolExecutions[0]?.body).toContain("required parameters were missing: path, content");
  expect(extractAssistantText(result.response)).toBe("Corrected.");
});

test("executeTurn runs Claude native Bash inside the disposable environment", async () => {
  if (process.platform !== "darwin") return;
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-native-loop-"));
  await writeFile(join(cwd, "source.txt"), "real workspace\n");
  const { client } = createMockClient([
    createResponse(null, [{
      id: "call-native-bash",
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: "printf isolated > generated.txt" }) },
    }]),
    createResponse("Native work completed safely."),
  ]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: `native-${Date.now()}`,
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions[0]?.tool).toBe("bash");
  expect(result.toolExecutions[0]?.ok).toBe(true);
  expect(result.toolExecutions[0]?.body).toContain("network denied");
  expect(await Bun.file(join(cwd, "generated.txt")).exists()).toBe(false);
});

test("executeTurn preserves shell pending metadata from gated commands", async () => {
  const { client } = createMockClient([
    createResponse(null, [
      {
        id: "call-shell",
        type: "function",
        function: {
          name: "shell",
          arguments: JSON.stringify({ command: "git push origin main" }),
        },
      },
    ]),
    createResponse("Waiting for approval."),
  ]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions).toHaveLength(1);
  expect(result.toolExecutions[0]?.shellPending?.command).toBe("git push origin main");
  expect(extractAssistantText(result.response)).toBe("Waiting for approval.");
});

test("shell approval is reserved for broad-impact commands", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-shell-"));

  const safe = await executeToolCall("shell", { command: "printf ok" }, { cwd });
  expect(safe.ok).toBe(true);
  expect(safe.shellPending).toBeUndefined();
  expect(safe.body).toBe("ok");

  const gated = await executeToolCall("shell", { command: "git push origin main" }, { cwd });
  expect(gated.ok).toBe(true);
  expect(gated.shellPending?.command).toBe("git push origin main");
});

test("GumOps tools run through configured checkout", async () => {
  const gumOpsPath = await mkdtemp(join(tmpdir(), "switchbay-gumops-"));
  const previous = Bun.env.SWITCHBAY_GUMOPS_PATH;
  Bun.env.SWITCHBAY_GUMOPS_PATH = gumOpsPath;
  await writeFile(
    join(gumOpsPath, "gumgent.py"),
    [
      "import sys",
      "if sys.argv[1:] == ['memory', 'list']:",
      "    print('gumroad:products')",
      "else:",
      "    print('ARGS:' + ' '.join(sys.argv[1:]))",
    ].join("\n"),
    "utf-8",
  );

  try {
    const result = await executeToolCall("gumops_memory_list", {}, { cwd: gumOpsPath });
    expect(result.ok).toBe(true);
    expect(result.body).toBe("gumroad:products");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_GUMOPS_PATH;
    } else {
      Bun.env.SWITCHBAY_GUMOPS_PATH = previous;
    }
  }
});

test("Gumroad sales alias resolves the synced GumOps manifest name", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-gumops-manifest-"));
  const engineDir = join(cwd, ".switchbay", "engines");
  await mkdir(engineDir, { recursive: true });
  await writeFile(join(engineDir, "gumops_runner.py"), "import sys\nprint('SALES:' + ' '.join(sys.argv[1:]))\n", "utf-8");
  await writeFile(join(engineDir, "gumops.engine.json"), JSON.stringify({
    id: "gumops",
    name: "Synced GumOps",
    tools: [
      { name: "gum_sales_summary", description: "Sales", command: "python3 gumops_runner.py sales_summary" },
      { name: "gum_sales_range", description: "Sales range", command: "python3 gumops_runner.py sales_range --start {{start}} --end {{end}}", required: ["start", "end"] },
    ],
  }), "utf-8");

  const result = await executeToolCall("gumroad_sales_summary", {}, { cwd });
  expect(result.ok).toBe(true);
  expect(result.body).toBe("SALES:sales_summary");

  const range = await executeToolCall("gumroad_sales_range", { start: "2026-07-07", end: "2026-07-13" }, { cwd });
  expect(range.ok).toBe(true);
  expect(range.body).toBe("SALES:sales_range --start 2026-07-07 --end 2026-07-13");
});

test("GumOps optional harnesses are exposed when present", async () => {
  const gumOpsPath = await mkdtemp(join(tmpdir(), "switchbay-gumops-harnesses-"));
  const previous = Bun.env.SWITCHBAY_GUMOPS_PATH;
  Bun.env.SWITCHBAY_GUMOPS_PATH = gumOpsPath;
  await mkdir(join(gumOpsPath, "engine_harnesses"), { recursive: true });
  await writeFile(join(gumOpsPath, "gumgent.py"), "print('fake gumops')\n", "utf-8");
  await writeFile(
    join(gumOpsPath, "engine_harnesses", "shopgent.py"),
    "import sys\nprint('SHOP:' + ' '.join(sys.argv[1:]))\n",
    "utf-8",
  );
  await writeFile(
    join(gumOpsPath, "engine_harnesses", "fbgent.py"),
    "import sys\nprint('FB:' + ' '.join(sys.argv[1:]))\n",
    "utf-8",
  );

  try {
    const listed = await executeToolCall("list_engine_tools", { engine_id: "gumops" }, { cwd: gumOpsPath });
    expect(listed.ok).toBe(true);
    expect(listed.body).toContain("shopify_products");
    expect(listed.body).toContain("facebook_page_insights");

    const products = await executeToolCall(
      "run_engine_tool",
      {
        engine_id: "gumops",
        tool_name: "shopify_products",
        args_json: JSON.stringify({ limit: 2, published_status: "any" }),
      },
      { cwd: gumOpsPath },
    );
    expect(products.ok).toBe(true);
    expect(products.body).toContain("SHOP:products --limit 2 --published-status any");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_GUMOPS_PATH;
    } else {
      Bun.env.SWITCHBAY_GUMOPS_PATH = previous;
    }
  }
});

test("Gumroad refunds are always staged for approval", async () => {
  const gumOpsPath = await mkdtemp(join(tmpdir(), "switchbay-gumops-refund-"));
  const previous = Bun.env.SWITCHBAY_GUMOPS_PATH;
  Bun.env.SWITCHBAY_GUMOPS_PATH = gumOpsPath;
  await writeFile(join(gumOpsPath, "gumgent.py"), "print('fake')\n", "utf-8");

  try {
    const result = await executeToolCall("gumroad_refund_sale", { sale_id: "sale_123", amount: 4.5 }, { cwd: gumOpsPath });
    expect(result.ok).toBe(true);
    expect(result.shellPending?.command).toContain("refund_gumroad_sale");
    expect(result.shellPending?.command).toContain("sale_123");
    expect(result.body).toContain("Awaiting approval");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_GUMOPS_PATH;
    } else {
      Bun.env.SWITCHBAY_GUMOPS_PATH = previous;
    }
  }
});

test("engine registry loads manifest tools from workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-engine-registry-"));
  const engineDir = join(cwd, ".switchbay", "engines");
  await mkdir(engineDir, { recursive: true });
  await writeFile(
    join(engineDir, "demo.engine.json"),
    JSON.stringify({
      id: "demo",
      name: "Demo Engine",
      description: "Tiny test engine.",
      tools: [
        {
          name: "say",
          description: "Say text.",
          command: "printf {{text}}",
          parameters: { text: { type: "string", description: "Text to print." } },
          required: ["text"],
        },
      ],
    }),
    "utf-8",
  );

  const listed = await executeToolCall("list_engines", {}, { cwd });
  expect(listed.ok).toBe(true);
  expect(listed.body).toContain("demo - Demo Engine");

  const result = await executeToolCall(
    "run_engine_tool",
    { engine_id: "demo", tool_name: "say", args_json: JSON.stringify({ text: "hello engine" }) },
    { cwd },
  );
  expect(result.ok).toBe(true);
  expect(result.body).toBe("hello engine");
});

test("engine registry includes synced Engine Bay manifests", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-engine-bay-workspace-"));
  const hubPath = await mkdtemp(join(tmpdir(), "switchbay-engine-bay-cache-"));
  const previous = Bun.env.SWITCHBAY_ENGINE_BAY_PATH;
  Bun.env.SWITCHBAY_ENGINE_BAY_PATH = hubPath;
  await mkdir(join(hubPath, "engines", "Demo"), { recursive: true });
  await writeFile(
    join(hubPath, "engines", "Demo", "demo.engine.json"),
    JSON.stringify({
      id: "hub_demo",
      name: "Hub Demo",
      description: "Demo engine from Engine Bay.",
      tools: [
        {
          name: "status",
          description: "Print status.",
          command: "printf hub-ok",
        },
      ],
    }),
    "utf-8",
  );

  try {
    const listed = await executeToolCall("list_engines", {}, { cwd });
    expect(listed.ok).toBe(true);
    expect(listed.body).toContain("hub_demo - Hub Demo");

    const result = await executeToolCall(
      "run_engine_tool",
      { engine_id: "hub_demo", tool_name: "status" },
      { cwd },
    );
    expect(result.ok).toBe(true);
    expect(result.body).toBe("hub-ok");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_ENGINE_BAY_PATH;
    } else {
      Bun.env.SWITCHBAY_ENGINE_BAY_PATH = previous;
    }
  }
});

test("creative engine is built in and writes local briefs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-creative-engine-"));

  const listed = await executeToolCall("list_engine_tools", { engine_id: "creative" }, { cwd });
  expect(listed.ok).toBe(true);
  expect(listed.body).toContain("creative_brief");
  expect(listed.body).toContain("creative_packet");
  expect(listed.body).toContain("name_storm");

  const result = await executeToolCall(
    "run_engine_tool",
    {
      engine_id: "creative",
      tool_name: "creative_brief",
      args_json: JSON.stringify({ notes: "Switchbay helps internal builders route creative work and local tools." }),
    },
    { cwd },
  );
  expect(result.ok).toBe(true);
  expect(result.body).toContain("# Creative Brief");
  expect(result.body).toContain("Saved: .switchbay/creative/briefs/");
});

test("creative packet alias writes a complete packet", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-creative-packet-"));

  const result = await executeToolCall(
    "creative_packet",
    {
      brief: "A terminal-first writing workbench for solo builders who want local creative control.",
      audience: "solo builders",
      format: "email",
      days: 3,
    },
    { cwd },
  );

  expect(result.ok).toBe(true);
  expect(result.body).toContain("# Creative Packet");
  expect(result.body).toContain("# Positioning Routes");
  expect(result.body).toContain("# Name Storm");
  expect(result.body).toContain("# Hook Bank");
  expect(result.body).toContain("# Email Draft");
  expect(result.body).toContain("Saved: .switchbay/creative/packets/");
});

test("web engine is built in and blocks private hosts by default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-web-engine-"));

  const listed = await executeToolCall("web_tools", {}, { cwd });
  expect(listed.ok).toBe(true);
  expect(listed.body).toContain("web_fetch");
  expect(listed.body).toContain("web_headers");

  const blocked = await executeToolCall("web_fetch", { url: "http://127.0.0.1" }, { cwd });
  expect(blocked.ok).toBe(false);
  expect(blocked.body).toContain("Blocked private or local host");
});

test("Thinkapse auto-discovery exposes local harness tools", async () => {
  const thinkapsePath = await mkdtemp(join(tmpdir(), "switchbay-thinkapse-"));
  const previous = Bun.env.SWITCHBAY_THINKAPSE_PATH;
  Bun.env.SWITCHBAY_THINKAPSE_PATH = thinkapsePath;
  await writeFile(
    join(thinkapsePath, "harness.py"),
    [
      "import sys",
      "if sys.argv[1:] == ['clean', '--dry-run']:",
      "    print('preview routes')",
      "else:",
      "    print('ARGS:' + ' '.join(sys.argv[1:]))",
    ].join("\n"),
    "utf-8",
  );

  try {
    const listed = await executeToolCall("list_engine_tools", { engine_id: "thinkapse" }, { cwd: thinkapsePath });
    expect(listed.ok).toBe(true);
    expect(listed.body).toContain("route_preview");

    const preview = await executeToolCall(
      "run_engine_tool",
      { engine_id: "thinkapse", tool_name: "route_preview" },
      { cwd: thinkapsePath },
    );
    expect(preview.ok).toBe(true);
    expect(preview.shellPending).toBeUndefined();
    expect(preview.body).toBe("preview routes");

    const apply = await executeToolCall(
      "run_engine_tool",
      { engine_id: "thinkapse", tool_name: "route_apply" },
      { cwd: thinkapsePath },
    );
    expect(apply.ok).toBe(true);
    expect(apply.shellPending?.command).toContain("python3 harness.py clean");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_THINKAPSE_PATH;
    } else {
      Bun.env.SWITCHBAY_THINKAPSE_PATH = previous;
    }
  }
});

test("/apply is not a local slash command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-apply-"));
  const filePath = join(cwd, "demo.txt");
  await writeFile(filePath, "old\n", "utf-8");

  const result = await tryLocalCommand("/apply", {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });

  expect(result.handled).toBe(false);
  expect(await readFile(filePath, "utf-8")).toBe("old\n");
});

test("agent commands support explicit and conversational activation", async () => {
  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: null,
  };

  const activated = await tryLocalCommand("/agent backend", baseOptions);
  expect(activated.handled).toBe(true);
  expect(activated.activateAgent).toBe("backend");

  const conversational = await tryLocalCommand("Switchbay, use Backend. Do a quick test and report errors.", baseOptions);
  expect(conversational.handled).toBe(true);
  expect(conversational.activateAgent).toBe("backend");
  expect(conversational.followUpInput).toBe("Do a quick test and report errors.");

  const missing = await tryLocalCommand("/agent missing-agent", baseOptions);
  expect(missing.handled).toBe(true);
  expect(missing.assistantMessage).toContain("No agent found");

  const oldDirectCommand = await tryLocalCommand("/backend", baseOptions);
  expect(oldDirectCommand.handled).toBe(false);
});

test("creation builders are slash-command only", async () => {
  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: null,
  };

  for (const request of [
    "Bay, make me a backend review agent",
    "let's build a custom engine for reports",
    "Bay, make an external MCP config for browser tools",
    "make a rule that Bay always reads spreadsheet quick starts",
    "create a release checklist skill",
    "For our Document Verifier agent, lets go ahead and make some skills for it as well. Once done, register them too.",
    "Bay, create a plugin for repo ops",
  ]) {
    expect((await tryLocalCommand(request, baseOptions)).handled).toBe(false);
  }

  expect((await tryLocalCommand("/create-agent", baseOptions)).openCreateAgent).toBe(true);
  expect((await tryLocalCommand("/create-engine", baseOptions)).openCreateEngine).toBe(true);
  expect((await tryLocalCommand("/create-mcp", baseOptions)).openCreateMcp).toBe(true);
  expect((await tryLocalCommand("/create-rule", baseOptions)).openCreateRule).toBe(true);
  expect((await tryLocalCommand("/create-skill", baseOptions)).openCreateSkill).toBe(true);
  expect((await tryLocalCommand("/create-plugin", baseOptions)).openCreatePlugin).toBe(true);

  const normalAsk = await tryLocalCommand("explain how this engine works", baseOptions);
  expect(normalAsk.handled).toBe(false);
});

test("conversational operator requests answer from local state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-operator-intent-"));
  const previousConfigDir = Bun.env.SWITCHBAY_CONFIG_DIR;
  Bun.env.SWITCHBAY_CONFIG_DIR = join(cwd, "user-config");

  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    runtimeLane: "cloud" as const,
    toolMode: "standard" as const,
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: "main",
      dirtyFiles: [" M src/demo.ts"],
      recentFiles: [],
      diff: { hasChanges: true, stat: "src/demo.ts | 1 +" },
    },
  };

  try {
    const added = await tryLocalCommand("Switchbay, remind me to test brew", baseOptions);
    expect(added.handled).toBe(true);
    expect(added.dailyBoardChanged).toBe(true);
    expect(added.assistantMessage).toContain("Local-first");
    expect(added.assistantMessage).toContain("test brew");

    const agenda = await tryLocalCommand("Switchbay, what's on my agenda?", baseOptions);
    expect(agenda.handled).toBe(false);

    const done = await tryLocalCommand("Switchbay, mark task 1 done", baseOptions);
    expect(done.handled).toBe(true);
    expect(done.dailyBoardChanged).toBe(true);
    expect(done.assistantMessage).toContain("Completed Daily Board task");

    const lane = await tryLocalCommand("Bay, what lane am I using?", baseOptions);
    expect(lane.handled).toBe(false);

    const git = await tryLocalCommand("Bay, what's changed in git?", baseOptions);
    expect(git.handled).toBe(false);

    const dirtyRepoQuestion = await tryLocalCommand("Bay, what file is dirty in the repo? What's the changes?", baseOptions);
    expect(dirtyRepoQuestion.handled).toBe(false);

    const workspace = await tryLocalCommand("Bay, what workspace am I in?", baseOptions);
    expect(workspace.handled).toBe(false);

    const mcp = await tryLocalCommand("Bay, is MCP on?", baseOptions);
    expect(mcp.handled).toBe(false);

    const normalAsk = await tryLocalCommand("Bay, explain this TypeScript function", baseOptions);
    expect(normalAsk.handled).toBe(false);
  } finally {
    if (previousConfigDir === undefined) {
      delete Bun.env.SWITCHBAY_CONFIG_DIR;
    } else {
      Bun.env.SWITCHBAY_CONFIG_DIR = previousConfigDir;
    }
    invalidateConfigCache();
  }
});

test("Switchbay CLI and drawer help prompts are deterministic", async () => {
  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    runtimeLane: "cloud" as const,
    toolMode: "standard" as const,
    workspace: null,
  };

  const ollama = await tryLocalCommand("Bay, how do I switch to Ollama?", baseOptions);
  expect(ollama.handled).toBe(true);
  expect(ollama.assistantMessage).toContain("Switchbay Control");
  expect(ollama.assistantMessage).toContain("/lane ollama");
  expect(ollama.assistantMessage).toContain("switchbay local-provider set ollama");

  const engines = await tryLocalCommand("Bay, how do I sync engines?", baseOptions);
  expect(engines.handled).toBe(true);
  expect(engines.assistantMessage).toContain("switchbay engines sync");

  const plugins = await tryLocalCommand("What command lists plugins?", baseOptions);
  expect(plugins.handled).toBe(true);
  expect(plugins.assistantMessage).toContain("switchbay plugins list");

  const agenda = await tryLocalCommand("Bay, what's the command for reminders?", baseOptions);
  expect(agenda.handled).toBe(true);
  expect(agenda.assistantMessage).toContain("/task add");

  const modelDrawer = await tryLocalCommand("Bay, open the model drawer", baseOptions);
  expect(modelDrawer.handled).toBe(true);
  expect(modelDrawer.assistantMessage).toContain("/model");

  const generic = await tryLocalCommand("Bay, how do I explain this TypeScript function?", baseOptions);
  expect(generic.handled).toBe(false);

  const workQuestion = await tryLocalCommand("Bay, what file is dirty in the repo? What's the changes?", baseOptions);
  expect(workQuestion.handled).toBe(false);
});

test("workspace slash commands show, add, and hop known workspaces", async () => {
  const originalCwd = process.cwd();
  const previousConfigDir = Bun.env.SWITCHBAY_CONFIG_DIR;
  const configDir = await mkdtemp(join(tmpdir(), "switchbay-workspace-config-"));
  const target = await mkdtemp(join(tmpdir(), "switchbay-workspace-target-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = configDir;
  invalidateConfigCache();

  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd: originalCwd,
      repoRoot: originalCwd,
      branch: "main",
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  };

  try {
    const status = await tryLocalCommand("/workspace", baseOptions);
    expect(status.handled).toBe(true);
    expect(status.assistantMessage).toContain("Workspace cwd");

    const added = await tryLocalCommand(`/workspace add ${target}`, baseOptions);
    expect(added.handled).toBe(true);
    expect(added.assistantMessage).toContain(target);

    const quoted = await tryLocalCommand(`/workspace add "${target}"`, baseOptions);
    expect(quoted.handled).toBe(true);
    expect(quoted.assistantMessage).toContain(target);
    expect(quoted.assistantMessage).not.toContain(`"${target}"`);
    expect(quoted.assistantMessage).not.toContain(`${originalCwd}/"`);

    const hopped = await tryLocalCommand(`/hop ${target}`, baseOptions);
    expect(hopped.handled).toBe(true);
    expect(hopped.travel?.toPath).toBe(target);
    expect(hopped.travel?.workspace.cwd).toBe(target);

    process.chdir(originalCwd);
    const conversationalHop = await tryLocalCommand(`hop to ${basename(target)}`, baseOptions);
    expect(conversationalHop.handled).toBe(true);
    expect(conversationalHop.travel?.toPath).toBe(target);
    expect(conversationalHop.travel?.workspace.cwd).toBe(target);

    process.chdir(originalCwd);
    const hopWithFollowUp = await tryLocalCommand(`hop to ${basename(target)}, then tell me the status`, baseOptions);
    expect(hopWithFollowUp.handled).toBe(true);
    expect(hopWithFollowUp.travel?.toPath).toBe(target);
    expect(hopWithFollowUp.followUpInput).toBe("What's changed in git?");

    process.chdir(originalCwd);
    const freshRepo = await mkdtemp(join(tmpdir(), "Fresh Workspace "));
    const explicitFreshHop = await tryLocalCommand(
      `hop in to "${freshRepo}", it is a fresh repo. Read the docs and tell me what should be built`,
      baseOptions,
    );
    expect(explicitFreshHop.handled).toBe(true);
    expect(explicitFreshHop.travel?.toPath).toBe(freshRepo);
    expect(explicitFreshHop.followUpInput).toBe("it is a fresh repo. Read the docs and tell me what should be built");

    process.chdir(originalCwd);
    const addressedHop = await tryLocalCommand(`Claude, hop in to ${basename(target)}`, baseOptions);
    expect(addressedHop.handled).toBe(false);

    const addressedHeyHop = await tryLocalCommand(`Hey GPT, hop to ${basename(target)} repo. Then tell me the status`, baseOptions);
    expect(addressedHeyHop.handled).toBe(false);

    process.chdir(originalCwd);
    const cdHop = await tryLocalCommand(`cd to ${basename(target)}, then tell me the status of the repo`, baseOptions);
    expect(cdHop.handled).toBe(true);
    expect(cdHop.travel?.toPath).toBe(target);
    expect(cdHop.followUpInput).toBe("What's changed in git?");

    process.chdir(originalCwd);
    const statusFromWorkspace = await tryLocalCommand(`I need the repo status, summarized. From "${basename(target)}"`, baseOptions);
    expect(statusFromWorkspace.handled).toBe(true);
    expect(statusFromWorkspace.travel?.toPath).toBe(target);
    expect(statusFromWorkspace.followUpInput).toBe("What's changed in git?");

    const createRepoRequest = await tryLocalCommand(
      'bay, I need you to make me a repo called "BillTend", no elaborate readme. Just a placeholder for working on the next project. Once it\'s done, you can commit and publish it. Private.',
      baseOptions,
    );
    expect(createRepoRequest.handled).toBe(false);

    const missingHop = await tryLocalCommand("hop to no-such-switchbay-workspace", baseOptions);
    expect(missingHop.handled).toBe(true);
    expect(missingHop.travel).toBeUndefined();
    expect(missingHop.assistantMessage).toContain("No workspace matched");
  } finally {
    process.chdir(originalCwd);
    if (previousConfigDir === undefined) {
      delete Bun.env.SWITCHBAY_CONFIG_DIR;
    } else {
      Bun.env.SWITCHBAY_CONFIG_DIR = previousConfigDir;
    }
    invalidateConfigCache();
  }
});

test("engine slash commands describe registered engines and creative tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-engine-commands-"));
  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  };

  const engines = await tryLocalCommand("/engines", baseOptions);
  expect(engines.handled).toBe(true);
  expect(engines.openEnginePicker).toBe(true);

  const engineList = await tryLocalCommand("/engines list", baseOptions);
  expect(engineList.handled).toBe(true);
  expect(engineList.assistantMessage).toContain("creative - Creative Engine");

  const creative = await tryLocalCommand("/creative", baseOptions);
  expect(creative.handled).toBe(true);
  expect(creative.assistantMessage).toContain("**Creative Engine**");
  expect(creative.assistantMessage).toContain("creative_packet");

  const web = await tryLocalCommand("/web", baseOptions);
  expect(web.handled).toBe(true);
  expect(web.assistantMessage).toContain("**Web Engine**");
  expect(web.assistantMessage).toContain("web_fetch");
});

test("toolbox tools and slash command expose built-in skills", async () => {
  const listed = await executeToolCall("list_toolbox_skills", {}, { cwd: process.cwd() });
  expect(listed.ok).toBe(true);
  expect(listed.body).toContain("code-review-pass");
  expect(listed.body).toContain("release-readiness");
  expect(listed.body).toContain("web-research");

  const read = await executeToolCall("read_toolbox_skill", { skill_id: "debugging-triage" }, { cwd: process.cwd() });
  expect(read.ok).toBe(true);
  expect(read.body).toContain("# Debugging Triage");

  const slash = await tryLocalCommand("/toolbox list", {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: null,
  });
  expect(slash.handled).toBe(true);
  expect(slash.assistantMessage).toContain("implementation-plan");
});

test("guide slash commands expose quick starts and rules", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-guides-"));
  const baseOptions = {
    client: {} as any,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  };

  const quickstarts = await tryLocalCommand("/quickstarts", baseOptions);
  expect(quickstarts.handled).toBe(true);
  expect(quickstarts.assistantMessage).toContain("Tool Use Quick Start");

  const rules = await tryLocalCommand("/rules", baseOptions);
  expect(rules.handled).toBe(true);
  expect(rules.assistantMessage).toContain("Local First Rule");

  const create = await tryLocalCommand("/rules create", baseOptions);
  expect(create.handled).toBe(true);
  expect(create.openCreateRule).toBe(true);
});

test("engine bay slash command lists cached templates", async () => {
  const hubPath = await mkdtemp(join(tmpdir(), "switchbay-engine-bay-command-"));
  const previous = Bun.env.SWITCHBAY_ENGINE_BAY_PATH;
  Bun.env.SWITCHBAY_ENGINE_BAY_PATH = hubPath;
  await mkdir(join(hubPath, "template"), { recursive: true });
  await writeFile(join(hubPath, "template", "default.engine.json"), "{}", "utf-8");

  try {
    const result = await tryLocalCommand("/engine-bay templates", {
      client: {} as any,
      profile: "switchbay",
      sessionId: "test-session",
      surface: "dev",
      workspace: null,
    });
    expect(result.handled).toBe(true);
    expect(result.assistantMessage).toContain("template/default.engine.json");
  } finally {
    if (previous === undefined) {
      delete Bun.env.SWITCHBAY_ENGINE_BAY_PATH;
    } else {
      Bun.env.SWITCHBAY_ENGINE_BAY_PATH = previous;
    }
  }
});
