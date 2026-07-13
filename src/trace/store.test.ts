import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import type { BuiltTurn, ExecutedTurn } from "../agent/loop";
import { describeLatestTrace, loadLatestTrace, saveTraceRecord } from "./store";

test("saveTraceRecord writes a latest trace with knowledge and tool receipts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-trace-"));
  await writeFile(join(cwd, "README.md"), "# Trace test\n", "utf-8");

  const turn: BuiltTurn = {
    mode: "build",
    objective: "trace approval gates",
    pendingPlan: [],
    resolvedProfile: "switchbay",
    request: {
      messages: [
        {
          role: "system",
          content: "WORKSPACE KNOWLEDGE MAP\n\nSource 1: README.md:1-3 [docs, score 4]\n```test```",
        },
        { role: "user", content: "trace this" },
      ],
    },
  };
  const executedTurn: ExecutedTurn = {
    response: {
      choices: [{ message: { role: "assistant", content: "Done." }, finish_reason: "stop" }],
      meta: { provider: "gemini", model: "gemini-2.5-flash" },
    },
    toolExecutions: [
      {
        tool: "read_file",
        ok: true,
        summary: "Read README.md",
        body: "# Trace test",
      },
    ],
  };

  await saveTraceRecord({
    assistantContent: "Done.",
    cwd,
    executedTurn,
    runtimeLane: "cloud",
    toolMode: "standard",
    sessionId: "session-trace",
    turn,
    userPrompt: "trace this",
    workspace: {
      cwd,
      repoRoot: cwd,
      branch: "main",
      dirtyFiles: [],
      recentFiles: [],
      diff: { hasChanges: false, stat: "" },
    },
  });

  const latest = await loadLatestTrace(cwd);
  expect(latest?.record.context.knowledgeSources).toEqual(["README.md:1-3 [docs, score 4]"]);
  expect(latest?.record.actions.tools[0]?.summary).toBe("Read README.md");
  expect(latest?.record.runtime.provider).toBe("gemini");
  expect(latest?.record.runtime.model).toBe("gemini-2.5-flash");

  const description = await describeLatestTrace(cwd);
  expect(description).toContain("Trace Ledger: Latest Turn");
  expect(description).toContain("trace approval gates");
  expect(description).toContain("README.md:1-3");
});
