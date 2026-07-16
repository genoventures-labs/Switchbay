import { expect, test } from "bun:test";
import type { TraceRecord } from "../trace/store";
import { estimateCost, estimateTraceCost, formatUsd, modelPrice } from "./cost";

const record = (provider: string, model: string): TraceRecord => ({
  version: 1, id: "t", sessionId: "s", createdAt: "2026-07-15T12:00:00Z", objective: "x", userPrompt: "x",
  runtime: { lane: provider === "ollama" ? "local" : "cloud", toolMode: "standard", provider, model },
  workspace: { cwd: "/tmp", dirtyFiles: [] }, context: { knowledgeSources: [], receipt: [], systemPromptChars: 0, promptChars: 0, estimatedPromptTokens: 1_000_000 },
  actions: { toolCount: 0, tools: [], changedFiles: [], pendingApprovals: [] }, result: { finalAnswer: "", finalAnswerChars: 0, estimatedAnswerTokens: 1_000_000 },
});

test("cost calculator prices known cloud models and treats local inference as zero marginal API cost", () => {
  expect(estimateTraceCost(record("openai", "gpt-5.4-mini-2026-03-17"))).toBe(5.25);
  expect(estimateTraceCost(record("anthropic", "claude-sonnet-4-6"))).toBe(18);
  expect(estimateTraceCost(record("google", "gemini-3.5-flash"))).toBe(10.5);
  expect(estimateTraceCost(record("ollama", "qwen"))).toBe(0);
  expect(estimateTraceCost({ ...record("ollama", "qwen"), runtime: { lane: "local", toolMode: "standard" } })).toBe(0);
});

test("cost calculator reports unpriced custom models instead of guessing", () => {
  expect(modelPrice("openai", "gpt-5.6-terra")).toBeNull();
  expect(estimateCost([record("openai", "gpt-5.6-terra")])).toEqual({ usd: 0, pricedTurns: 0, unpricedTurns: 1, totalTurns: 1 });
  expect(formatUsd(0.00125)).toBe("$0.0013");
});
