import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { skillAuthoringPath } from "../config/authoring-paths";

export type SkillProvider = "auto" | "openai" | "claude" | "gemini" | "generic";
export type SkillImportMode = "preserve" | "convert";
export type SkillBridgeInput = { content?: string; sourcePath?: string; filename?: string; provider?: SkillProvider; mode?: SkillImportMode; name?: string; description?: string };
export type SkillBridgePreview = { id: string; name: string; description: string; provider: Exclude<SkillProvider, "auto">; mode: SkillImportMode; destination: string; content: string; originalFilename: string };

const MAX_SKILL_BYTES = 256 * 1024;

export async function previewSkillImport(input: SkillBridgeInput, cwd = process.cwd()): Promise<SkillBridgePreview> {
  const source = await resolveSource(input);
  if (!source.content.trim()) throw new Error("Skill content is required.");
  if (Buffer.byteLength(source.content, "utf8") > MAX_SKILL_BYTES) throw new Error("Skill files must be 256 KB or smaller.");
  const parsed = parseFrontmatter(source.content);
  const provider = detectProvider(input.provider ?? "auto", parsed.meta, source.content, source.filename);
  const name = oneLine(input.name || parsed.meta.name || parsed.meta.title || firstHeading(parsed.body) || filenameTitle(source.filename));
  const id = slugify(parsed.meta.id || name);
  const description = oneLine(input.description || parsed.meta.description || firstParagraph(parsed.body) || `Imported ${provider} skill: ${name}.`);
  const mode = input.mode === "convert" ? "convert" : "preserve";
  const triggers = listValue(parsed.meta.triggers).length ? listValue(parsed.meta.triggers) : inferTriggers(name, description);
  const content = mode === "convert"
    ? convertedSkill({ id, name, description, provider, triggers, body: parsed.body })
    : preservedSkill({ id, name, description, provider, triggers, body: parsed.body });
  return { id, name, description, provider, mode, destination: skillAuthoringPath(id, cwd), content, originalFilename: source.filename };
}

export async function importSkill(input: SkillBridgeInput, cwd = process.cwd()): Promise<SkillBridgePreview> {
  const preview = await previewSkillImport(input, cwd);
  if (existsSync(preview.destination)) throw Object.assign(new Error(`Skill already exists: ${preview.destination}`), { code: "resource_exists" });
  await fs.mkdir(path.dirname(preview.destination), { recursive: true });
  await fs.writeFile(preview.destination, preview.content, { encoding: "utf8", flag: "wx" });
  return preview;
}

async function resolveSource(input: SkillBridgeInput): Promise<{ content: string; filename: string }> {
  if (typeof input.content === "string" && input.content.trim()) return { content: input.content, filename: input.filename?.trim() || "imported-skill.md" };
  const requested = input.sourcePath?.trim();
  if (!requested) return { content: "", filename: input.filename?.trim() || "imported-skill.md" };
  const resolved = path.resolve(requested.replace(/^~(?=\/|$)/, process.env.HOME || ""));
  const info = await fs.stat(resolved).catch(() => null);
  if (!info) throw new Error(`Skill source not found: ${resolved}`);
  const file = info.isDirectory() ? await findSkillFile(resolved) : resolved;
  return { content: await fs.readFile(file, "utf8"), filename: path.basename(file) };
}

async function findSkillFile(directory: string): Promise<string> {
  for (const name of ["SKILL.md", "skill.md", "GEMINI.md", "CLAUDE.md"]) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  const markdown = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith(".md"));
  if (markdown.length === 1) return path.join(directory, markdown[0]!);
  throw new Error("Directory needs SKILL.md, skill.md, GEMINI.md, CLAUDE.md, or exactly one Markdown file.");
}

function preservedSkill(input: { id: string; name: string; description: string; provider: string; triggers: string[]; body: string }): string {
  return `---\nid: ${input.id}\nname: ${yamlText(input.name)}\ndescription: ${yamlText(input.description)}\nlanguages: [any]\nagents: [any]\ntags: [imported, ${input.provider}]\ntriggers: [${input.triggers.map(yamlText).join(", ")}]\nsource_format: ${input.provider}\nimport_mode: preserve\n---\n\n${input.body.trim()}\n`;
}

function convertedSkill(input: { id: string; name: string; description: string; provider: string; triggers: string[]; body: string }): string {
  const useWhen = section(input.body, ["Use When", "When to Use", "Triggers"]) || input.triggers.map((trigger) => `- ${trigger}`).join("\n");
  const method = section(input.body, ["Method", "Workflow", "Instructions", "Process", "Steps"]) || stripLeadingHeading(input.body);
  const output = section(input.body, ["Output", "Deliverables", "Result"]) || "- Complete the requested work and report the result, evidence, and remaining risks.";
  const guardrails = section(input.body, ["Guardrails", "Safety", "Rules", "Constraints"]) || "- Preserve the imported skill's intent.\n- Stay within the active workspace and verify material work.\n- Surface missing context instead of inventing facts.";
  return `---\nid: ${input.id}\nname: ${yamlText(input.name)}\ndescription: ${yamlText(input.description)}\nlanguages: [any]\nagents: [any]\ntags: [imported, converted, ${input.provider}]\ntriggers: [${input.triggers.map(yamlText).join(", ")}]\nsource_format: ${input.provider}\nimport_mode: convert\n---\n\n# ${input.name}\n\n## Use When\n\n${useWhen.trim()}\n\n## Method\n\n${method.trim()}\n\n## Output\n\n${output.trim()}\n\n## Guardrails\n\n${guardrails.trim()}\n`;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { meta: {}, body: normalized };
  const meta: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const index = line.indexOf(":");
    if (index > 0) meta[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return { meta, body: normalized.slice(end + 4).replace(/^\n/, "") };
}

function detectProvider(requested: SkillProvider, meta: Record<string, string>, content: string, filename: string): Exclude<SkillProvider, "auto"> {
  if (requested !== "auto") return requested;
  const signal = `${meta.provider || ""} ${meta.model || ""} ${filename} ${content.slice(0, 1200)}`.toLowerCase();
  if (/claude|anthropic/.test(signal)) return "claude";
  if (/gemini|google ai/.test(signal)) return "gemini";
  if (/openai|chatgpt|codex|gpt/.test(signal)) return "openai";
  return "generic";
}

function section(body: string, headings: string[]): string {
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = body.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}
function stripLeadingHeading(body: string): string { return body.replace(/^#\s+.+\n+/, "").trim(); }
function firstHeading(body: string): string { return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || ""; }
function firstParagraph(body: string): string { return body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s+.*$/gm, "").trim()).find((part) => part && !part.startsWith("-") && !part.startsWith("```")) || ""; }
function filenameTitle(filename: string): string { return filename.replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "imported-skill"; }
function oneLine(value: string): string { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240); }
function listValue(value = ""): string[] { return value.replace(/^\[|\]$/g, "").split(/[,\n]/).map(oneLine).filter(Boolean); }
function inferTriggers(name: string, description: string): string[] { return [...new Set(`${name},${description}`.toLowerCase().split(/[^a-z0-9-]+/).filter((word) => word.length > 3))].slice(0, 10); }
function yamlText(value: string): string { return JSON.stringify(oneLine(value)); }
