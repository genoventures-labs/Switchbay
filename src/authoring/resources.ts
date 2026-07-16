import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAgentDefinition } from "../agent/agents";
import { pluginAuthoringPath, skillAuthoringPath } from "../config/authoring-paths";
import { workspaceStorageDir } from "../config/paths";
import { normalizePluginManifest, pluginManifestTemplate } from "../plugins/registry";

export type ResourceKind = "agent" | "skill" | "plugin" | "guide";

export type ResourceDraftInput = {
  kind: ResourceKind;
  name: string;
  description: string;
  triggers?: string;
  instructions?: string;
  guardrails?: string;
  guideKind?: "quickstart" | "rule";
  version?: string;
};

export type SavedResource = { kind: ResourceKind; id: string; name: string; path: string; content: string };

export async function createAuthoredResource(input: ResourceDraftInput, cwd = process.cwd()): Promise<SavedResource> {
  const draft = buildResourceDraft(input, cwd);
  if (existsSync(draft.path)) throw Object.assign(new Error(`${draft.kind} already exists: ${draft.path}`), { code: "resource_exists" });
  await fs.mkdir(path.dirname(draft.path), { recursive: true });
  await fs.writeFile(draft.path, draft.content, { encoding: "utf-8", flag: "wx" });
  return draft;
}

export function buildResourceDraft(input: ResourceDraftInput, cwd = process.cwd()): SavedResource {
  const name = oneLine(input.name);
  const description = oneLine(input.description);
  if (!name) throw new Error("name is required");
  if (!description) throw new Error("description is required");
  if (!(["agent", "skill", "plugin", "guide"] as string[]).includes(input.kind)) throw new Error("kind must be agent, skill, plugin, or guide");
  const id = slugify(name);
  const triggers = splitList(input.triggers || name);
  const instructions = input.instructions?.trim() || description;
  const guardrails = input.guardrails?.trim() || "Stay within the active workspace, surface risky assumptions, and verify material work.";

  if (input.kind === "agent") {
    const draft = buildAgentDefinition({ name, specialty: description, approach: instructions, rules: guardrails, scope: "workspace" }, cwd);
    return { kind: input.kind, id: draft.id, name, path: draft.savePath, content: draft.content };
  }
  if (input.kind === "skill") {
    const content = `---\nid: ${id}\nname: ${name}\ndescription: ${description}\nlanguages: [any]\nagents: [any]\ntags: [workflow]\ntriggers: [${triggers.join(", ")}]\n---\n\n# ${name}\n\n## Use When\n\n${bulletLines(input.triggers || description)}\n\n## Method\n\n${numberLines(instructions)}\n\n## Output\n\n- A concise result with the work performed and verification completed.\n\n## Guardrails\n\n${bulletLines(guardrails)}\n`;
    return { kind: input.kind, id, name, path: skillAuthoringPath(id, cwd), content };
  }
  if (input.kind === "plugin") {
    const manifest = normalizePluginManifest({ ...pluginManifestTemplate(id, name, description), version: oneLine(input.version || "0.1.0") });
    return { kind: input.kind, id, name, path: pluginAuthoringPath(id, cwd), content: `${JSON.stringify(manifest, null, 2)}\n` };
  }
  const guideKind = input.guideKind === "rule" ? "rule" : "quickstart";
  const folder = guideKind === "rule" ? "rules" : "quickstarts";
  const content = `---\nid: ${id}\ntitle: ${name}\nkind: ${guideKind}\ndescription: ${description}\ntriggers: [${triggers.join(", ")}]\n---\n\n# ${name}\n\n## ${guideKind === "rule" ? "Rule" : "Quick Start"}\n\n${bulletLines(instructions)}\n\n## Guardrails\n\n${bulletLines(guardrails)}\n`;
  return { kind: input.kind, id, name, path: path.join(workspaceStorageDir(cwd), folder, `${id}.${guideKind}.md`), content };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "resource";
}
function oneLine(value: string): string { return String(value || "").trim().replace(/\s+/g, " "); }
function splitList(value: string): string[] { return [...new Set(value.split(/[,\n]/).map(oneLine).filter(Boolean))].slice(0, 12); }
function bulletLines(value: string): string { return value.split("\n").map(oneLine).filter(Boolean).map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n"); }
function numberLines(value: string): string { return value.split("\n").map(oneLine).filter(Boolean).map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "")}`).join("\n"); }
