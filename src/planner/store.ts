import path from "node:path";
import fs from "node:fs/promises";
import type { ActivePlan } from "../agent/turn-state";
import { workspaceDataPath } from "../config/paths";

export function activePlanPath(cwd: string): string { return workspaceDataPath(cwd, "plans/active-plan.json"); }

export async function loadActivePlan(cwd: string): Promise<ActivePlan | null> {
  try {
    const raw = JSON.parse(await fs.readFile(activePlanPath(cwd), "utf-8"));
    if (raw?.objective && Array.isArray(raw.tasks)) {
      const completedSteps = raw.tasks.map((task: any, index: number) => task.status === "done" ? index : -1).filter((index: number) => index >= 0);
      const currentStep = raw.tasks.findIndex((task: any) => task.status === "in_progress" || task.status === "todo");
      return { id: `workspace-${raw.createdAt ?? "plan"}`, goal: raw.objective, steps: raw.tasks.map((task: any) => task.title), currentStep: currentStep < 0 ? raw.tasks.length : currentStep, completedSteps, status: currentStep < 0 ? "complete" : "awaiting_continue" };
    }
    return raw?.goal && Array.isArray(raw.steps) ? raw as ActivePlan : null;
  } catch { return null; }
}

export async function saveActivePlan(cwd: string, plan: ActivePlan): Promise<void> {
  const target = activePlanPath(cwd);
  const tasks = plan.steps.map((title, index) => ({ id: String(index + 1), title, status: plan.completedSteps.includes(index) ? "done" : index === plan.currentStep && plan.status === "running" ? "in_progress" : "todo" }));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify({ version: 1, objective: plan.goal, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tasks }, null, 2)}\n`, "utf-8");
}

export async function buildActivePlanPromptBlock(cwd: string): Promise<string> {
  const plan = await loadActivePlan(cwd);
  if (!plan) return "";
  return `\n\nACTIVE WORKSPACE PLAN (durable across sessions and models):\nGoal: ${plan.goal}\n${plan.steps.map((step, index) => `${plan.completedSteps.includes(index) ? "[done]" : index === plan.currentStep ? "[current]" : "[todo]"} ${index + 1}. ${step}`).join("\n")}`;
}
