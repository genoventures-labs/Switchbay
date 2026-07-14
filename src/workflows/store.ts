import path from "node:path";
import fs from "node:fs/promises";
import { workspaceDataPath } from "../config/paths";

export type SavedWorkflow = { version: 1; id: string; name: string; instructions: string; createdAt: string; updatedAt: string };
export function workflowsDir(cwd: string): string { return workspaceDataPath(cwd, "workflows"); }

export async function listWorkflows(cwd: string): Promise<SavedWorkflow[]> {
  const entries = await fs.readdir(workflowsDir(cwd)).catch(() => []);
  const loaded = await Promise.all(entries.filter((name) => name.endsWith(".workflow.json")).map((name) => readWorkflow(cwd, name.replace(/\.workflow\.json$/, ""))));
  return loaded.filter((item): item is SavedWorkflow => Boolean(item)).sort((a, b) => a.id.localeCompare(b.id));
}

export async function readWorkflow(cwd: string, id: string): Promise<SavedWorkflow | null> {
  try { const value = JSON.parse(await fs.readFile(path.join(workflowsDir(cwd), `${slug(id)}.workflow.json`), "utf-8")); return value?.version === 1 ? value : null; } catch { return null; }
}

export async function saveWorkflow(cwd: string, id: string, instructions: string): Promise<SavedWorkflow> {
  const cleanId = slug(id); if (!cleanId || !instructions.trim()) throw new Error("Usage: /workflow save <name> :: <instructions>");
  const prior = await readWorkflow(cwd, cleanId); const now = new Date().toISOString();
  const workflow: SavedWorkflow = { version: 1, id: cleanId, name: id.trim(), instructions: instructions.trim(), createdAt: prior?.createdAt ?? now, updatedAt: now };
  await fs.mkdir(workflowsDir(cwd), { recursive: true });
  await fs.writeFile(path.join(workflowsDir(cwd), `${cleanId}.workflow.json`), `${JSON.stringify(workflow, null, 2)}\n`, "utf-8");
  return workflow;
}

export async function buildWorkflowsPromptBlock(cwd: string): Promise<string> {
  const workflows = await listWorkflows(cwd); if (!workflows.length) return "";
  return `\n\nSAVED WORKFLOWS (explicit reusable procedures; inspect before running):\n${workflows.map((item) => `- ${item.id}: ${item.instructions.slice(0, 180)}`).join("\n")}`;
}

export function formatWorkflows(workflows: SavedWorkflow[]): string { return workflows.length ? workflows.map((item) => `- **${item.id}**: ${item.instructions}`).join("\n") : "No saved workflows. Use `/workflow save <name> :: <instructions>`."; }
function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
