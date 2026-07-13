import path from "node:path";
import fs from "node:fs/promises";

type PlanTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  notes?: string;
};

type Plan = {
  version: 1;
  objective: string;
  createdAt: string;
  updatedAt: string;
  tasks: PlanTask[];
};

type Args = Record<string, string>;
const VALID_STATUSES = new Set<PlanTask["status"]>(["todo", "in_progress", "done", "blocked"]);

async function main() {
  const [action, ...rest] = Bun.argv.slice(2);
  const args = parseArgs(rest);
  const cwd = process.cwd();

  switch (action) {
    case "create": {
      const objective = required(args, "objective");
      const steps = parseSteps(args.steps);
      const plan: Plan = {
        version: 1,
        objective,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: steps.map((title, index) => ({ id: String(index + 1), title, status: "todo" })),
      };
      await savePlan(cwd, plan);
      console.log(renderPlan(plan));
      return;
    }
    case "show": {
      console.log(renderPlan(await loadPlan(cwd)));
      return;
    }
    case "add": {
      const plan = await loadPlan(cwd);
      plan.tasks.push({ id: nextId(plan), title: required(args, "task"), status: "todo", notes: optional(args, "notes") });
      await savePlan(cwd, plan);
      console.log(renderPlan(plan));
      return;
    }
    case "update": {
      const plan = await loadPlan(cwd);
      const task = findTask(plan, required(args, "task_id"));
      const status = required(args, "status") as PlanTask["status"];
      if (!VALID_STATUSES.has(status)) throw new Error("status must be todo, in_progress, done, or blocked.");
      task.status = status;
      if (optional(args, "notes")) task.notes = args.notes;
      await savePlan(cwd, plan);
      console.log(renderPlan(plan));
      return;
    }
    case "clear": {
      await fs.rm(planPath(cwd), { force: true });
      console.log("Active plan cleared.");
      return;
    }
    default:
      throw new Error("Usage: planner-engine.ts <create|show|add|update|clear> [--objective text] [--steps JSON] [--task text] [--task-id id] [--status todo|in_progress|done|blocked]");
  }
}

function planPath(cwd: string) { return path.join(cwd, ".switchbay", "plans", "active-plan.json"); }

async function loadPlan(cwd: string): Promise<Plan> {
  try {
    return JSON.parse(await fs.readFile(planPath(cwd), "utf-8")) as Plan;
  } catch {
    throw new Error("No active plan. Create one with planner.create first.");
  }
}

async function savePlan(cwd: string, plan: Plan) {
  plan.updatedAt = new Date().toISOString();
  const destination = planPath(cwd);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
}

function renderPlan(plan: Plan) {
  const symbols: Record<PlanTask["status"], string> = { todo: "○", in_progress: "◐", done: "✓", blocked: "!" };
  return [
    "# Active Plan",
    "",
    `**Objective:** ${plan.objective}`,
    "",
    ...plan.tasks.map((task) => `${symbols[task.status]} ${task.id}. ${task.title} _[${task.status}]_${task.notes ? ` — ${task.notes}` : ""}`),
    "",
    `Saved: ${planPath(process.cwd())}`,
  ].join("\n");
}

function parseSteps(value?: string) {
  if (!value?.trim() || value === "None") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((step) => typeof step !== "string" || !step.trim())) throw new Error();
    return parsed.map((step) => step.trim());
  } catch {
    throw new Error("steps must be a JSON array of task titles.");
  }
}

function parseArgs(args: string[]): Args {
  const output: Args = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key ?? ""}`);
    output[key.slice(2)] = args[index + 1] ?? "";
  }
  return output;
}

function required(args: Args, key: string) { const value = args[key]?.trim(); if (!value) throw new Error(`${key} is required.`); return value; }
function optional(args: Args, key: string) { const value = args[key]?.trim(); return value && value !== "None" ? value : undefined; }
function nextId(plan: Plan) { return String(Math.max(0, ...plan.tasks.map((task) => Number(task.id) || 0)) + 1); }
function findTask(plan: Plan, id: string) { const task = plan.tasks.find((entry) => entry.id === id); if (!task) throw new Error(`No task ${id} in the active plan.`); return task; }

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
