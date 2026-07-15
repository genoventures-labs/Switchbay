import { expect, test } from "bun:test";
import { barChart, flowGraph, sparkline } from "../tui/charts/text";
import type { TraceRecord } from "../trace/store";
import { formatTraceGraph, formatUsage } from "./usage";

function record(input: Partial<TraceRecord> = {}): TraceRecord {
  return {
    version: 1,
    id: "trace-1",
    sessionId: "session-1",
    createdAt: "2026-07-12T12:00:00.000Z",
    objective: "test",
    userPrompt: "test",
    runtime: { lane: "cloud", toolMode: "standard", model: "gpt-test", provider: "openai" },
    workspace: { cwd: "/tmp/test", dirtyFiles: [] },
    context: { knowledgeSources: ["README.md"], systemPromptChars: 100, promptChars: 50, estimatedPromptTokens: 40 },
    actions: { toolCount: 1, tools: [{ tool: "read_file", ok: true, summary: "Read README", bodyPreview: "", bodyLength: 0 }], changedFiles: [], pendingApprovals: [] },
    result: { finalAnswer: "done", finalAnswerChars: 4, estimatedAnswerTokens: 10, finishReason: "stop" },
    ...input,
  };
}

test("terminal chart primitives render deterministic text", () => {
  expect(sparkline([0, 1, 2, 4])).toBe("▁▃▅█");
  expect(barChart([{ label: "A", value: 2 }, { label: "B", value: 1 }], 4)).toContain("A  ████  2");
  expect(flowGraph([{ label: "Start" }, { label: "Done", tone: "ok" }])).toContain("◆ Start\n│\n▼\n✓ Done");
});

test("usage formats trace estimates and route bars", () => {
  const output = formatUsage([record({ runtime: { lane: "cloud", toolMode: "standard", provider: "openai", model: "gpt-5.4-mini" } }), record({ id: "trace-2", runtime: { lane: "local", toolMode: "standard", provider: "ollama", model: "qwen" } })], new Date("2026-07-12T20:00:00Z"));
  expect(output).toContain("Turns");
  expect(output).toContain("total 100");
  expect(output).toContain("openai");
  expect(output).toContain("ollama");
  expect(output).toContain("Estimated API spend");
  expect(output).toContain("Session");
  expect(output).toContain("Today");
  expect(output).toContain("7 days");
  expect(output).toContain("Lifetime");
  expect(output).toContain("Spend by provider");
  expect(output).toContain("token counts and spend are estimates");
});

test("trace graph renders ordered tools and failures", () => {
  const output = formatTraceGraph(record({ actions: { toolCount: 2, tools: [
    { tool: "read_file", ok: true, summary: "Read a file", bodyPreview: "", bodyLength: 0 },
    { tool: "shell", ok: false, summary: "Command failed", bodyPreview: "", bodyLength: 0 },
  ], changedFiles: [], pendingApprovals: [] } }));
  expect(output).toContain("◆ Prompt");
  expect(output).toContain("✓ read_file");
  expect(output).toContain("✗ shell");
  expect(output).toContain("✓ Answer");
});
