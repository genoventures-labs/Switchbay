import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import type { ChatRuntimeClient } from "../runtime/client";
import type { ChatCompletionRequest, ChatCompletionResponse, ToolCall } from "../runtime/types";
import { executeToolCall } from "./tools";
import {
  executeTurn,
  extractAssistantText,
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
    resolvedProfile: "ori_code",
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
  expect(parseApprovalIntent("n")).toBe("cancel");
  expect(parseApprovalIntent("apply")).toBeNull();
  expect(parseApprovalIntent("/cancel")).toBeNull();
  expect(parseApprovalIntent("later")).toBeNull();
});

test("tool fallback returns the first useful tool body", () => {
  const fallback = synthesizeAssistantFallback("status?", [
    { tool: "git_status", ok: true, summary: "status", body: "Working tree clean." },
  ]);

  expect(fallback).toBe("Working tree clean.");
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

test("executeTurn feeds native tool results back into the next model call", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ori-code-loop-tool-"));
  await writeFile(join(cwd, "demo.txt"), "file body\n", "utf-8");
  const { client, calls } = createMockClient([
    createResponse(null, [
      {
        id: "call-read",
        type: "function",
        function: { name: "read_file", arguments: JSON.stringify({ path: "demo.txt" }) },
      },
    ]),
    createResponse("Read complete."),
  ]);

  const result = await executeTurn({
    client: client as ChatRuntimeClient,
    cwd,
    sessionId: "test-session",
    surface: "dev",
    turn: createTurn(),
  });

  expect(result.toolExecutions).toHaveLength(1);
  expect(result.toolExecutions[0]?.body).toBe("file body\n");
  expect(extractAssistantText(result.response)).toBe("Read complete.");
  expect(calls).toHaveLength(2);
  expect(calls[1]?.messages.some((message) => message.role === "tool" && message.content === "file body\n")).toBe(true);
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
  const cwd = await mkdtemp(join(tmpdir(), "ori-code-shell-"));

  const safe = await executeToolCall("shell", { command: "printf ok" }, { cwd });
  expect(safe.ok).toBe(true);
  expect(safe.shellPending).toBeUndefined();
  expect(safe.body).toBe("ok");

  const gated = await executeToolCall("shell", { command: "git push origin main" }, { cwd });
  expect(gated.ok).toBe(true);
  expect(gated.shellPending?.command).toBe("git push origin main");
});

test("/apply is not a local slash command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ori-code-apply-"));
  const filePath = join(cwd, "demo.txt");
  await writeFile(filePath, "old\n", "utf-8");

  const result = await tryLocalCommand("/apply", {
    client: {} as any,
    profile: "ori_code",
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

test("agent commands use explicit /agent id activation", async () => {
  const baseOptions = {
    client: {} as any,
    profile: "ori_code",
    sessionId: "test-session",
    surface: "dev",
    workspace: null,
  };

  const activated = await tryLocalCommand("/agent backend", baseOptions);
  expect(activated.handled).toBe(true);
  expect(activated.activateAgent).toBe("backend");

  const missing = await tryLocalCommand("/agent missing-agent", baseOptions);
  expect(missing.handled).toBe(true);
  expect(missing.assistantMessage).toContain("No agent found");

  const oldDirectCommand = await tryLocalCommand("/backend", baseOptions);
  expect(oldDirectCommand.handled).toBe(false);
});
