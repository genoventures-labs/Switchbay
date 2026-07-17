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
    description: "How models should discover, select, execute, and report Switchbay model tools.",
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
      "- For Gumroad reporting, use `gumroad_sales_range` for weekly, monthly, or date-specific claims. `gumroad_sales_summary` is all-time only. Never infer a time range from an all-time result, and surface unavailable refunds as unavailable.",
      "- For multi-step work, inspect the Planner Engine and use it to create a small, durable plan. Update a task when starting, completing, or hitting a real blocker; do not create a plan for a one-step answer.",
      "- When moving projects, call `workspace_hop` first. Finding or mentioning a path does not change the active workspace.",
      "- If a grounding tool fails, report the failure and stop; never manufacture file contents, package metadata, git state, or tool results.",
      "- Keep the final answer outcome-first. Mention material capability use compactly, but do not narrate routine reads or internal tool-selection reasoning.",
    ].join("\n"),
  },
  {
    id: "planning-quick-start",
    title: "Planning Quick Start",
    description: "How models should make multi-step work visible and durable with the Planner Engine.",
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
    id: "skill-bridge-quick-start",
    title: "Skill Bridge Quick Start",
    description: "How models should preview, preserve, and convert GPT, Claude, Gemini, and generic Markdown skills.",
    kind: "quickstart",
    triggers: ["import skill", "convert skill", "claude skill", "gemini skill", "gpt skill", "codex skill", "SKILL.md"],
    source: "builtin",
    path: "builtin/skill-bridge-quick-start",
    body: [
      "- Inspect the `skill-bridge` engine and use `preview_skill_import` before every import.",
      "- Accept a Markdown file or a directory containing `SKILL.md`, `skill.md`, `CLAUDE.md`, or `GEMINI.md`.",
      "- Use provider `auto` unless the user names the source. Valid providers are `openai`, `claude`, `gemini`, and `generic`.",
      "- Use mode `preserve` when the user wants the original instructions used as-is with Switchbay compatibility metadata.",
      "- Use mode `convert` when the user wants normalized Use When, Method, Output, and Guardrails sections.",
      "- Show the detected name, provider, mode, and destination from the preview before importing.",
      "- `import_skill` requires approval because it writes to the shared Engine Toolboxes source repository.",
      "- Never overwrite an existing skill. Rename deliberately or stop and report the collision.",
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
    description: "How models should use the guarded Web Engine.",
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
    description: "How models should handle Switchbay MCP bridge setup and failures.",
    kind: "quickstart",
    triggers: ["mcp", "external tools", "local tools", "browser tools", "plugin"],
    source: "builtin",
    path: "builtin/mcp-lane-quick-start",
    body: [
      "- The MCP config defaults to `~/.switchbay/mcp.json`.",
      "- Only trusted catalog integrations should be generated by the active model.",
      "- Switchbay MCP bridge is enabled with `/mcp on` or `SWITCHBAY_TOOL_MODE=switchbay-mcp`.",
      "- Cloud and local model lanes can both use Switchbay's normal tool bridge.",
      "- External MCP servers may use stdio or Streamable HTTP transports.",
      "- Discovered tools remain subject to Switchbay allowlists and execution policy.",
    ].join("\n"),
  },
  {
    id: "engine-bay-quick-start",
    title: "Engine Bay Quick Start",
    description: "How models should use swappable engines.",
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
    id: "workspace-scout-quick-start",
    title: "Workspace Scout Quick Start",
    description: "How models should use the WorkspaceScout engine for repo introspection without leaving the workspace.",
    kind: "quickstart",
    triggers: ["workspace scout", "snapshot", "stack detect", "deps check", "workspace overview", "repo overview", "git status engine"],
    source: "builtin",
    path: "builtin/workspace-scout-quick-start",
    body: [
      "- Call `status` first to confirm the engine is ready before any other tool.",
      "- Prefer `snapshot` for a first-look at an unfamiliar workspace — it combines file tree, git state, stack, and package.json in one call.",
      "- Use `git_status` when you only need current branch, dirty files, and recent commits; it is faster than a full snapshot.",
      "- Use `stack_detect` when the user asks what tech the workspace uses or before suggesting build commands.",
      "- Use `deps_check` when the user asks about packages, scripts, or whether dependencies are outdated.",
      "- Pass the absolute workspace path as `workspace`; omit it to default to the active cwd.",
      "- All tools are read-only and run locally — no network access, no external service.",
      "- Do not re-run `snapshot` on every turn; cache the result in context and call it again only when files may have changed.",
    ].join("\n"),
  },
  {
    id: "file-helper-quick-start",
    title: "File Helper Quick Start",
    description: "How models should use the File Helper engine for sandboxed file reads, searches, and in-place edits.",
    kind: "quickstart",
    triggers: ["file helper", "read file engine", "list directory engine", "search file", "replace in file", "file sandbox"],
    source: "builtin",
    path: "builtin/file-helper-quick-start",
    body: [
      "- Always pass `root` to sandbox paths within the workspace; omit it only when no path restriction is needed.",
      "- Use `list_directory` to confirm a path exists before reading or editing it.",
      "- Use `search_in_file` with `regex: true` for pattern searches; keep `max_results` low (≤ 50) for large files.",
      "- `replace_in_file` mutates the file in-place and requires approval — always show the user the `search` and `replace` values before running.",
      "- Set `count: 1` on `replace_in_file` when replacing only the first occurrence; `count: 0` replaces all.",
      "- Do not use File Helper to read files that the model's native `read_file` tool can already access; reserve it for sandboxed or guarded scenarios.",
      "- Report exact match counts and line numbers from `search_in_file` before proposing edits.",
    ].join("\n"),
  },
  {
    id: "gumops-quick-start",
    title: "GumOps Quick Start",
    description: "How models should use the GumOps engine for Gumroad seller analytics, product lookups, and guarded refunds.",
    kind: "quickstart",
    triggers: ["gumroad", "gumops", "sales", "revenue", "products", "refund", "gumroad sales", "seller analytics"],
    source: "builtin",
    path: "builtin/gumops-quick-start",
    body: [
      "- Run `gum_health_check` first in any new session to confirm the GUMROAD_ACCESS_TOKEN is present and the API is reachable.",
      "- Use `gum_refresh_memory` at the start of a research session to prime working memory with current products and sales data.",
      "- `gum_sales_summary` is all-time only — never state a time range from its output.",
      "- Use `gum_sales_range` with explicit YYYY-MM-DD dates for any weekly, monthly, or date-bounded revenue claim.",
      "- Use `gum_sales_by_month` for month-over-month trends; use `gum_compare_months` for a direct two-month diff.",
      "- Use `gum_find_product` when the user names a product by title; use `gum_get_product` when you already have a product ID.",
      "- `gum_refund_preview` is always required before `gum_refund_sale` — show the preview result to the user and wait for explicit confirmation.",
      "- `gum_refund_sale` is irreversible and requires approval; never auto-run it.",
      "- Refund availability comes from the API; never infer or estimate refund amounts from summary data.",
      "- Store intermediate research findings with `gum_memory_add` so multi-turn analysis survives context resets.",
    ].join("\n"),
  },
  {
    id: "macos-agent-quick-start",
    title: "MacOS Agent Quick Start",
    description: "How models should use the MacOS Agent engine to open apps, run scripts, manage clipboard, and take screenshots.",
    kind: "quickstart",
    triggers: ["macos", "mac agent", "open app", "applescript", "clipboard", "screenshot", "notification", "mac defaults"],
    source: "builtin",
    path: "builtin/macos-agent-quick-start",
    body: [
      "- Run `status` first to confirm the engine is available on the host machine.",
      "- `open_app` accepts app names, file paths, folder paths, and URLs — use it instead of shell `open` for traceability.",
      "- `run_script` executes via /bin/zsh; keep scripts short and idempotent. Always require approval for scripts with side effects.",
      "- `defaults_get` and `defaults_set` operate on macOS preference domains (e.g. `com.apple.finder`). Read before writing.",
      "- `defaults_set` requires approval because it modifies system or app preferences.",
      "- `clipboard_get` reads the current clipboard; `clipboard_set` overwrites it — warn the user before overwriting.",
      "- `screenshot` saves to the specified output path; confirm the path is writable before calling.",
      "- `notify` sends a local macOS notification — useful for alerting the user when a long background task completes.",
      "- All tools run locally; none cross a network boundary.",
    ].join("\n"),
  },
  {
    id: "ollama-vision-quick-start",
    title: "Ollama Vision Quick Start",
    description: "How models should use the Ollama Vision engine to describe images, generate training captions, and produce person-focused descriptions.",
    kind: "quickstart",
    triggers: ["ollama vision", "image describe", "lora caption", "caption image", "vision model", "local vision", "image caption"],
    source: "builtin",
    path: "builtin/ollama-vision-quick-start",
    body: [
      "- Run `status` before any image tool to confirm Ollama is running and a vision model is available.",
      "- Run `list_models` to confirm the desired model is pulled before passing it as `model`; default to `qwen2.5vl:7b` if the user does not specify.",
      "- `describe` returns a general-purpose image description — use it for scene understanding, product shots, or UI screenshots.",
      "- `describe_person` is tuned for LoRA training datasets; it focuses on face, hair, clothing, and posture. Only use it when the image contains a person.",
      "- `caption` accepts three styles: `training` (short LoRA/dataset caption), `alttext` (accessibility alt text), and `natural` (conversational sentence). Match the style to the user's goal.",
      "- Pass the absolute path to the image file as the `image` parameter.",
      "- All inference runs locally through Ollama — no image data leaves the machine.",
      "- If Ollama is not running, instruct the user to start it with `ollama serve` before retrying.",
    ].join("\n"),
  },
  {
    id: "pinata-quick-start",
    title: "PINATA Quick Start",
    description: "How models should run a structured product-opportunity research session using the PINATA Reddit workbench.",
    kind: "quickstart",
    triggers: ["pinata", "product research", "reddit research", "opportunity score", "pain signals", "market research", "winner matrix"],
    source: "builtin",
    path: "builtin/pinata-quick-start",
    body: [
      "- PINATA is a deliberate, model-in-the-loop research workflow — do not run all tools in one pass.",
      "- Start each session with `search_reddit` using specific pain-focused queries (e.g. 'frustrating', 'wish there was', 'problem with').",
      "- After reviewing results, call `save_signal` only for posts you and the user explicitly agree are meaningful. Do not auto-save.",
      "- Use `list_signals` between rounds to review what has been saved before searching more.",
      "- Call `cluster_signals` after collecting at least 5–10 signals to surface recurring pain themes.",
      "- Run `challenge_thesis` on any opportunity before scoring it — look for disconfirming evidence first.",
      "- Use `score_opportunity` for each distinct opportunity; present the 7-dimension scores to the user before calling `publish_matrix`.",
      "- `publish_matrix` writes files to disk — confirm the output path with the user before running.",
      "- Surface signal counts, search terms used, and any disconfirming evidence found when presenting conclusions.",
    ].join("\n"),
  },
  {
    id: "web-search-engine-quick-start",
    title: "Web Search Engine Quick Start",
    description: "How models should use the DuckDuckGo-backed Web Search engine for live search, page scraping, and bounded crawls.",
    kind: "quickstart",
    triggers: ["web search engine", "duckduckgo", "web scrape", "crawl", "search web", "web search tool", "scrape url"],
    source: "builtin",
    path: "builtin/web-search-engine-quick-start",
    body: [
      "- Use `web_search` for open-ended queries; it returns ranked results with titles, URLs, and descriptions — no API key needed.",
      "- Use `web_scrape` only with an explicit URL provided by the user; do not construct URLs to scrape autonomously.",
      "- `web_scrape` with `extract: links` is useful for discovering navigation targets before a crawl.",
      "- `web_crawl` is bounded (max depth 3, max 20 pages) and stays within the seed domain — use it for structured site exploration, not general surfing.",
      "- `web_crawl` requires approval because it makes multiple outbound requests.",
      "- Cite every URL when web-sourced facts appear in the answer.",
      "- Report when a page returned an error, was empty, or was truncated — do not silently omit failures.",
      "- Do not use `web_crawl` for high-frequency polling or monitoring; it is a one-shot research tool.",
    ].join("\n"),
  },
  {
    id: "facebook-engine-quick-start",
    title: "Facebook Engine Quick Start",
    description: "How models should use the Facebook Graph API engine to fetch objects, edges, and page insights.",
    kind: "quickstart",
    triggers: ["facebook", "facebook graph", "graph api", "page insights", "fb engine", "facebook api"],
    source: "builtin",
    path: "builtin/facebook-engine-quick-start",
    body: [
      "- The engine requires a valid Facebook Graph API access token in the environment (`FB_ACCESS_TOKEN` or equivalent). Confirm token presence before calling any tool.",
      "- Use `get_object` to fetch a specific node (user, page, post, group) by its ID. Specify only the `fields` you need — broad field lists may hit rate limits.",
      "- Use `get_edge` to traverse relationships (e.g. `posts`, `photos`, `feed`) from a known node ID.",
      "- Use `get_page_insights` only for Facebook Pages the authenticated token has manage access to; it will fail on pages the token cannot administer.",
      "- All tools are read-only — they do not post, comment, or mutate any Facebook data.",
      "- Graph API tokens expire; if a call returns an auth error, instruct the user to refresh the token before retrying.",
      "- Surface the raw `error` field from failed API responses — do not silently swallow Graph API errors.",
    ].join("\n"),
  },
  {
    id: "domaintools-quick-start",
    title: "Domain Tools Quick Start",
    description: "How models should use the Domain Tools engine to validate domain names and check TLD recognition.",
    kind: "quickstart",
    triggers: ["domain tools", "domain check", "check domain", "tld check", "domain available", "domain valid"],
    source: "builtin",
    path: "builtin/domaintools-quick-start",
    body: [
      "- `check_domain` validates the domain format and reports whether its TLD is recognized — it does not perform a live registrar availability lookup.",
      "- `check_tld` is a subset of `check_domain`; use it when you only need to confirm the TLD is valid (e.g. `.io`, `.dev`, `.xyz`).",
      "- Do not claim a domain is 'available' based solely on TLD recognition — availability requires a live WHOIS or registrar check which this engine does not perform.",
      "- Pass the full domain including TLD (e.g. `example.com`, not just `example`).",
      "- Both tools run locally with no network call — results reflect local TLD data, not live registrar state.",
    ].join("\n"),
  },
  {
    id: "ruby-text-helper-quick-start",
    title: "Ruby Text Helper Quick Start",
    description: "How models should use the Ruby Text Helper engine for LLM-powered text summarization, sentiment, and analysis.",
    kind: "quickstart",
    triggers: ["text helper", "ruby text", "summarize text", "key points", "sentiment analysis", "explain text", "reason text"],
    source: "builtin",
    path: "builtin/ruby-text-helper-quick-start",
    body: [
      "- The engine requires either an `OPENAI_API_KEY` or a running LM Studio local model. Confirm availability before use.",
      "- `summarize` produces a concise summary — use it when the user wants the gist of a long document or passage.",
      "- `key_points` extracts discrete, enumerable takeaways — prefer it over `summarize` when the user asks 'what are the main points'.",
      "- `sentiment` returns tone, mood, and intent — use it for customer feedback, reviews, or communication analysis.",
      "- `explain` unpacks meaning and implied conclusions — use it when the user wants the text interpreted, not just compressed.",
      "- `reason` surfaces insights and next steps through structured analysis — use it for decision-support or strategy review.",
      "- Pass the full text as the `text` argument. Very long inputs may be truncated by the underlying model's context window.",
      "- All tools call out to an LLM (OpenAI or LM Studio) — they are not purely local and may incur API cost.",
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

export async function buildGuidesPromptBlock(cwd = process.cwd(), maxGuides = 24): Promise<string> {
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
