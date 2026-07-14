import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkflows, readWorkflow, saveWorkflow } from "./store";

test("saved workflows are workspace scoped and reusable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-workflow-"));
  const saved = await saveWorkflow(cwd, "Weekly Report", "Pull sales, verify dates, summarize.");
  expect(saved.id).toBe("weekly-report");
  expect((await listWorkflows(cwd)).map((item) => item.id)).toEqual(["weekly-report"]);
  expect((await readWorkflow(cwd, "weekly-report"))?.instructions).toContain("verify dates");
});
