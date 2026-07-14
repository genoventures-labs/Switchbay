import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadActivePlan, saveActivePlan } from "./store";

test("active plan survives as workspace state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-plan-"));
  await saveActivePlan(cwd, { id: "p", goal: "Ship it", steps: ["Build", "Test"], currentStep: 1, completedSteps: [0], status: "running" });
  const plan = await loadActivePlan(cwd);
  expect(plan?.goal).toBe("Ship it");
  expect(plan?.completedSteps).toEqual([0]);
  expect(plan?.currentStep).toBe(1);
});
