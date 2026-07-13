import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { userConfigDir, workspaceStorageDir } from "../config/paths";
import { pluginAssetPaths } from "../plugins/registry";

export type GuideKind = "quickstart" | "rule";
export type GuideSource = "builtin" | "user" | "workspace" | "plugin";

export type Guide = {
  id: string;
  title: string;
  description: string;
  kind: GuideKind;
  triggers: string[];
  source: GuideSource;
  path: string;
  body: string;
};

export type RuleDraftAnswers = {
  name: string;
  trigger: string;
  rule: string;
  appliesTo: string;
  scope: string;
};

export type PendingRuleDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
};

const BUILTIN_GUIDES: Guide[] = [
  {
    id: "model-tools-quick-start",
    title: "Model Tools Quick Start",
    description: "How Bay should discover, select, execute, and report Switchbay model tools.",
    kind: "quickstart",
    triggers: ["model tools", "tool choice", "capabilities", "agents", "guides", "plugins", "engines", "mcp", "workspace hop"],
    source: "builtin",
    path: "builtin/model-tools-quick-start",
    body: [
      "- Start with `list_model_tools` when the needed native capability is unclear; use `describe_model_tool` before calling an unfamiliar tool.",
      "- Prefer the narrowest typed model tool over `shell`. Examples: `workspace_hop` over `cd`, `read_json` over shelling to `cat`, and `git_status` over a generic command.",
      "- Use capability readers before guessing: `list_agents`/`read_agent`, `list_guides`/`read_guide`, `list_plugins`/`read_plugin`, `list_engines`/`list_engine_tools`, and `list_toolbox_skills`/`read_toolbox_skill`.",
      "- Treat tool policy as authoritative: read tools may inspect, write tools may mutate locally, external tools cross a service boundary, and approval tools must wait for user consent.",
      "- Dynamic MCP tools use `mcp__<server>__<tool>` names. Engine execution goes through `run_engine_tool`. Never invent either name.",
      "- For multi-step work, inspect the Planner Engine and use it to create a small, durable plan. Update a task when starting, completing, or hitting a real blocker; do not create a plan for a one-step answer.",
      "- When moving projects, call `workspace_hop` first. Finding or mentioning a path does not change the active workspace.",
      "- If a grounding tool fails, report the failure and stop; never manufacture file contents, package metadata, git state, or tool results.",
      "- Keep the final answer outcome-first. Mention material capability use compactly, but do not narrate routine reads or internal tool-selection reasoning.",
    ].join("\n"),
  },
  {
    id: "planning-quick-start",
    title: "Planning Quick Start",
    description: "How Bay should make multi-step work visible and durable with the Planner Engine.",
    kind: "quickstart",
    triggers: ["plan", "planner", "tasks", "milestones", "multi-step", "roadmap", "track progress"],
    source: "builtin",
    path: "builtin/planning-quick-start",
    body: [
      "- For work with multiple dependent steps, call `list_engine_tools` for `planner`, then use `run_engine_tool` with `create_plan`.",
      "- Keep plans short, observable, and ordered: inspect, implement, verify is often enough.",
      "- Use `update_task` to mark the current task in progress and record meaningful blockers or completed checks.",
      "- Use `show_plan` before resuming a session or reporting overall progress.",
      "- A plan supports the work; it never replaces checking the actual workspace, files, tests, or outputs.",
    ].join("\n"),
  },
  {
    id: "tool-use-quick-start",
    title: "Tool Use Quick Start",
    description: "Default tool lane behavior for local coding work.",
    kind: "quickstart",
    triggers: ["tools", "files", "edit", "command", "shell", "tests", "build"],
    source: "builtin",
    path: "builtin/tool-use-quick-start",
    body: [
      "- Read files and list directories before changing code.",
      "- Prefer targeted `apply_patch` edits over full rewrites.",
      "- Run focused verification after code changes: typecheck, tests, or build.",
      "- Use approvals only for destructive, privileged, publishing, or broad external-impact actions.",
      "- Keep tool summaries concise; put detailed traces in the tool panel, not the main answer.",
    ].join("\n"),
  },
  {
    id: "web-research-quick-start",
    title: "Web Research Quick Start",
    description: "How Bay should use the guarded Web Engine.",
    kind: "quickstart",
    triggers: ["web", "latest", "current", "url", "docs", "source", "verify online"],
    source: "builtin",
    path: "builtin/web-research-quick-start",
    body: [
      "- Use `web_fetch`, `web_headers`, or `web_links` only for explicit public URLs.",
      "- Cite the URL when web-fetched facts affect the answer.",
      "- Say when a page could not be fetched, was truncated, or lacked evidence.",
      "- Do not imply live verification unless a web tool succeeded.",
    ].join("\n"),
  },
  {
    id: "mcp-lane-quick-start",
    title: "Switchbay MCP Quick Start",
    description: "How Bay should handle Switchbay MCP bridge setup and failures.",
    kind: "quickstart",
    triggers: ["mcp", "external tools", "local tools", "browser tools", "plugin"],
    source: "builtin",
    path: "builtin/mcp-lane-quick-start",
    body: [
      "- The MCP config defaults to `~/.switchbay/mcp.json`.",
      "- Only trusted catalog integrations should be generated by Bay.",
      "- Switchbay MCP bridge is enabled with `/mcp on` or `SWITCHBAY_TOOL_MODE=switchbay-mcp`.",
      "- Cloud and local model lanes can both use Switchbay's normal tool bridge.",
      "- External MCP servers may use stdio or Streamable HTTP transports.",
      "- Discovered tools remain subject to Switchbay allowlists and execution policy.",
    ].join("\n"),
  },
  {
    id: "engine-bay-quick-start",
    title: "Engine Bay Quick Start",
    description: "How Bay should use swappable engines.",
    kind: "quickstart",
    triggers: ["engine", "engine bay", "toolbox", "tool call", "run engine"],
    source: "builtin",
    path: "builtin/engine-bay-quick-start",
    body: [
      "- Use `list_engines` before assuming an engine exists.",
      "- Use `list_engine_tools` before running an engine tool.",
      "- Respect engine-level approval settings.",
      "- If an engine is absent, explain how to sync or configure it instead of inventing tools.",
    ].join("\n"),
  },
  {
    id: "local-first-rule",
    title: "Local First Rule",
    description: "Default operating rule for Switchbay sessions.",
    kind: "rule",
    triggers: ["default", "workspace", "repo", "local"],
    source: "builtin",
    path: "builtin/local-first-rule",
    body: [
      "- Treat the current workspace as the active world.",
      "- Do not cross into sibling repos, host services, or private infrastructure unless the user asks.",
      "- Prefer repo patterns and existing helpers over new abstractions.",
    ].join("\n"),
  },
];

const materializeLocks = new Map<string, Promise<string>>();

export function ruleDraftPath(answers: RuleDraftAnswers, cwd = process.cwd()): string {
  const id = slugify(answers.name || "custom-rule");
  const scope = answers.scope.trim().toLowerCase();
  const root = scope.includes("workspace")
    ? path.join(workspaceStorageDir(cwd), "rules")
    : path.join(userConfigDir(), "rules");
  return path.join(root, `${id}.rule.md`);
}

export function generateRuleDraft(answers: RuleDraftAnswers, cwd = process.cwd()): PendingRuleDraft {
  const id = slugify(answers.name || "custom-rule");
  const title = answers.name.trim() || "Custom Rule";
  const triggers = splitList(answers.trigger || answers.appliesTo || title);
  const content = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "kind: rule",
    `description: ${oneLine(answers.appliesTo || answers.rule || "Custom Switchbay operating rule.")}`,
    `triggers: [${triggers.join(", ")}]`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Applies When",
    "",
    answers.appliesTo.trim() ? `- ${answers.appliesTo.trim()}` : `- ${triggers.join(", ") || "This rule is relevant."}`,
    "",
    "## Rule",
    "",
    ...answers.rule.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => `- ${line.replace(/^[-*]\s*/, "")}`),
    "",
  ].join("\n");

  return {
    id,
    name: title,
    content,
    savePath: ruleDraftPath(answers, cwd),
  };
}

export async function loadGuides(cwd = process.cwd()): Promise<Guide[]> {
  const userRoot = userConfigDir();
  const workspaceRoot = workspaceStorageDir(cwd);
  const [userQuickstarts, userRules, workspaceQuickstarts, workspaceRules, pluginGuides] = await Promise.all([
    loadGuidesFromDir(path.join(userRoot, "quickstarts"), "quickstart", "user"),
    loadGuidesFromDir(path.join(userRoot, "rules"), "rule", "user"),
    loadGuidesFromDir(path.join(workspaceRoot, "quickstarts"), "quickstart", "workspace"),
    loadGuidesFromDir(path.join(workspaceRoot, "rules"), "rule", "workspace"),
    loadPluginGuides(cwd),
  ]);

  return mergeGuides([
    ...BUILTIN_GUIDES,
    ...userQuickstarts,
    ...userRules,
    ...workspaceQuickstarts,
    ...workspaceRules,
    ...pluginGuides,
  ]);
}

export async function describeGuides(cwd = process.cwd(), kind?: GuideKind): Promise<string> {
  const guides = (await loadGuides(cwd)).filter((guide) => !kind || guide.kind === kind);
  const title = kind === "rule" ? "Rules" : kind === "quickstart" ? "Quick Starts" : "Quick Starts And Rules";
  const lines = [
    title,
    `User rules: ${path.join(userConfigDir(), "rules")}`,
    `User quick starts: ${path.join(userConfigDir(), "quickstarts")}`,
    `Workspace rules: ${path.join(workspaceStorageDir(cwd), "rules")}`,
    `Workspace quick starts: ${path.join(workspaceStorageDir(cwd), "quickstarts")}`,
    `Plugin guides: ${path.join(workspaceStorageDir(cwd), "plugins", "<id>", "guides")}`,
    "",
    ...guides.map((guide) => `- \`${guide.id}\` [${guide.source}/${guide.kind}] ${guide.title}: ${guide.description}`),
  ];
  return lines.join("\n");
}

export async function buildGuidesPromptBlock(cwd = process.cwd(), maxGuides = 8): Promise<string> {
  const guides = await loadGuides(cwd);
  if (!guides.length) return "";
  const directory = await materializeGuideDirectory(cwd, guides);
  const selected = guides.slice(0, maxGuides).map((guide) =>
    `- ${guide.id}: ${guide.title} [${guide.source}/${guide.kind}] — ${guide.description || "No description"} — triggers: ${guide.triggers.slice(0, 8).join(", ") || "general"}`
  );
  return `\n\nQUICK GUIDE DIRECTORY (authoritative merged guides):
Directory: ${directory}
Index: ${path.join(directory, "INDEX.md")}
${selected.join("\n")}

Before matching tool, lane, safety, or workflow work, use list_directory on this directory and read_file on the relevant guide. Apply only guides that match the current task. Workspace guides override plugin, user, and built-in guides with the same id. If a guide materially shapes the work, disclose it as \"Using: guide/<id>\".`;
}

export async function materializeGuideDirectory(cwd = process.cwd(), loaded?: Guide[]): Promise<string> {
  const previous = materializeLocks.get(cwd) ?? Promise.resolve("");
  const current = previous.catch(() => "").then(() => writeGuideDirectory(cwd, loaded));
  materializeLocks.set(cwd, current);
  try {
    return await current;
  } finally {
    if (materializeLocks.get(cwd) === current) materializeLocks.delete(cwd);
  }
}

async function writeGuideDirectory(cwd: string, loaded?: Guide[]): Promise<string> {
  const guides = loaded ?? await loadGuides(cwd);
  const directory = path.join(workspaceStorageDir(cwd), "runtime", "guides");
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  const rows: string[] = ["# Switchbay Quick Guide Directory", "", "Merged precedence: workspace > plugin > user > built-in.", ""];
  for (const guide of guides) {
    const filename = `${guide.id}.${guide.kind}.md`;
    const content = [
      "---",
      `id: ${guide.id}`,
      `title: ${guide.title}`,
      `kind: ${guide.kind}`,
      `source: ${guide.source}`,
      `description: ${guide.description}`,
      `triggers: [${guide.triggers.join(", ")}]`,
      `original_path: ${guide.path}`,
      "---",
      "",
      guide.body,
      "",
    ].join("\n");
    await fs.writeFile(path.join(directory, filename), content, "utf-8");
    rows.push(`- [${guide.title}](./${filename}) — ${guide.id} [${guide.source}/${guide.kind}] — ${guide.description}`);
  }
  await fs.writeFile(path.join(directory, "INDEX.md"), `${rows.join("\n")}\n`, "utf-8");
  return directory;
}

async function loadGuidesFromDir(dir: string, kind: GuideKind, source: GuideSource): Promise<Guide[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const guides: Guide[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const absolute = path.join(dir, entry.name);
      const content = await fs.readFile(absolute, "utf-8");
      guides.push(parseGuideMarkdown(content, absolute, kind, source));
    } catch {
      // Ignore malformed local guide files.
    }
  }
  return guides;
}

async function loadPluginGuides(cwd: string): Promise<Guide[]> {
  const files = await pluginAssetPaths("guides", cwd);
  const guides: Guide[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf-8");
      guides.push(parseGuideMarkdown(content, file, "quickstart", "plugin"));
    } catch {
      // Ignore malformed plugin guide files.
    }
  }
  return guides;
}

function parseGuideMarkdown(content: string, filePath: string, fallbackKind: GuideKind, source: GuideSource): Guide {
  const { meta, body } = parseFrontmatter(content);
  const fallbackId = path.basename(filePath).replace(/\.rule\.md$|\.quickstart\.md$|\.md$/i, "");
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    id: stringMeta(meta.id, fallbackId),
    title: stringMeta(meta.title, title ?? fallbackId),
    description: stringMeta(meta.description, ""),
    kind: meta.kind === "quickstart" || meta.kind === "rule" ? meta.kind : fallbackKind,
    triggers: listMeta(meta.triggers, []),
    source,
    path: filePath,
    body: body.trim(),
  };
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  if (!content.startsWith("---\n")) return { meta: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: content };
  const raw = content.slice(4, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");
  const meta: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body };
}

function mergeGuides(guides: Guide[]): Guide[] {
  const merged = new Map<string, Guide>();
  for (const guide of guides) merged.set(guide.id, guide);
  return [...merged.values()].sort((a, b) => {
    const sourceRank = sourceWeight(a.source) - sourceWeight(b.source);
    if (sourceRank !== 0) return sourceRank;
    const kindRank = a.kind.localeCompare(b.kind);
    if (kindRank !== 0) return kindRank;
    return a.id.localeCompare(b.id);
  });
}

function sourceWeight(source: GuideSource): number {
  if (source === "workspace") return 0;
  if (source === "plugin") return 1;
  if (source === "user") return 2;
  return 3;
}

function stringMeta(value: string | undefined, fallback: string): string {
  return value?.trim().replace(/^["']|["']$/g, "") || fallback;
}

function listMeta(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return splitList(value.replace(/^\[|\]$/g, ""));
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "custom-rule";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

function limitLines(value: string, count: number): string {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, count).join("\n");
}
