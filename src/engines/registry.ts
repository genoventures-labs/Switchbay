import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { engineBayManifestPaths } from "./hub";
import { pluginAssetPaths } from "../plugins/registry";

export type EngineToolParam = {
  type: string;
  description: string;
};

export type EngineTool = {
  name: string;
  description: string;
  command: string;
  parameters?: Record<string, EngineToolParam>;
  required?: string[];
  approval?: "auto" | "always";
  approval_reason?: string;
};

export type EngineManifest = {
  id: string;
  name: string;
  description: string;
  cwd?: string;
  tools: EngineTool[];
  approval?: {
    always?: string[];
  };
};

export type EngineRegistry = {
  engines: EngineManifest[];
  warnings: string[];
};

export type RenderedEngineCommand = {
  engine: EngineManifest;
  tool: EngineTool;
  command: string;
  cwd: string;
  requiresApproval: boolean;
  approvalReason: string;
};

export async function loadEngineRegistry(cwd = process.cwd()): Promise<EngineRegistry> {
  const warnings: string[] = [];
  const engines = new Map<string, EngineManifest>();

  for (const manifestPath of await discoverEngineManifestPaths(cwd)) {
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const manifest = normalizeManifest(JSON.parse(raw), path.dirname(manifestPath));
      // Discovery is ordered from most local/explicit to shared fallbacks.
      // Do not let a synced Engine Bay manifest replace a workspace engine.
      if (!engines.has(manifest.id)) {
        engines.set(manifest.id, manifest);
      }
    } catch (err) {
      warnings.push(`${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const creativeEngine = createCreativeEngine(cwd);
  if (!engines.has(creativeEngine.id)) {
    engines.set(creativeEngine.id, creativeEngine);
  }

  const webEngine = createWebEngine(cwd);
  if (!engines.has(webEngine.id)) {
    engines.set(webEngine.id, webEngine);
  }

  const plannerEngine = createPlannerEngine(cwd);
  if (!engines.has(plannerEngine.id)) {
    engines.set(plannerEngine.id, plannerEngine);
  }

  const gumOpsEngine = await discoverGumOpsEngine(cwd);
  const hasExplicitGumOpsPath = Boolean(Bun.env.SWITCHBAY_GUMOPS_PATH?.trim() || Bun.env.GUMOPS_PATH?.trim());
  if (gumOpsEngine && (hasExplicitGumOpsPath || !engines.has(gumOpsEngine.id))) {
    engines.set(gumOpsEngine.id, gumOpsEngine);
  }

  const thinkapseEngine = await discoverThinkapseEngine(cwd);
  if (thinkapseEngine && !engines.has(thinkapseEngine.id)) {
    engines.set(thinkapseEngine.id, thinkapseEngine);
  }

  return {
    engines: [...engines.values()].sort((a, b) => a.id.localeCompare(b.id)),
    warnings,
  };
}

export async function renderEngineToolCommand(
  engineId: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd = process.cwd(),
): Promise<RenderedEngineCommand> {
  const registry = await loadEngineRegistry(cwd);
  const engine = registry.engines.find((entry) => entry.id === engineId);
  if (!engine) {
    throw new Error(`Engine not found: ${engineId}`);
  }

  const tool = engine.tools.find((entry) => entry.name === toolName);
  if (!tool) {
    throw new Error(`Tool not found for engine ${engineId}: ${toolName}`);
  }

  for (const required of tool.required ?? []) {
    if (args[required] === undefined || args[required] === null || String(args[required]).trim() === "") {
      throw new Error(`Engine tool ${engineId}.${toolName} requires ${required}.`);
    }
  }

  const command = renderTemplate(tool.command, args);
  const engineCwd = resolvePath(engine.cwd ?? cwd, cwd);
  const requiresApproval = tool.approval === "always" || engineRequiresApproval(engine, tool, command);
  const approvalReason = tool.approval_reason ?? `Run ${engine.name} tool ${tool.name}.`;

  return { engine, tool, command, cwd: engineCwd, requiresApproval, approvalReason };
}

export async function describeEngines(cwd = process.cwd()): Promise<string> {
  const registry = await loadEngineRegistry(cwd);
  const lines = registry.engines.map((engine) => {
    const toolList = engine.tools.map((tool) => tool.name).join(", ");
    return `${engine.id} - ${engine.name}: ${engine.description}\nTools: ${toolList || "(none)"}`;
  });

  if (registry.warnings.length > 0) {
    lines.push(`Warnings:\n${registry.warnings.join("\n")}`);
  }

  return lines.join("\n\n") || "No engines registered.";
}

export function parseEngineArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") {
    throw new Error("Engine args must be a JSON object string.");
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Engine args must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeManifest(raw: unknown, manifestDir: string): EngineManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest must be a JSON object.");
  }
  const manifest = raw as Partial<EngineManifest>;
  if (!manifest.id || !/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
    throw new Error("Manifest requires an id using letters, numbers, underscores, or hyphens.");
  }
  if (!manifest.name) {
    throw new Error("Manifest requires a name.");
  }
  if (!Array.isArray(manifest.tools)) {
    throw new Error("Manifest requires a tools array.");
  }

  return {
    id: manifest.id,
    name: String(manifest.name),
    description: String(manifest.description ?? ""),
    cwd: manifest.cwd ? resolvePath(manifest.cwd, manifestDir) : manifestDir,
    approval: manifest.approval,
    tools: manifest.tools.map((tool) => normalizeTool(tool)),
  };
}

function normalizeTool(raw: unknown): EngineTool {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tool entries must be JSON objects.");
  }
  const tool = raw as Partial<EngineTool>;
  if (!tool.name || !/^[a-zA-Z0-9_-]+$/.test(tool.name)) {
    throw new Error("Tool requires a name using letters, numbers, underscores, or hyphens.");
  }
  if (!tool.command) {
    throw new Error(`Tool ${tool.name} requires a command.`);
  }
  return {
    name: tool.name,
    description: String(tool.description ?? ""),
    command: String(tool.command),
    parameters: tool.parameters ?? {},
    required: Array.isArray(tool.required) ? tool.required.map(String) : [],
    approval: tool.approval === "always" ? "always" : "auto",
    approval_reason: tool.approval_reason,
  };
}

async function discoverEngineManifestPaths(cwd: string): Promise<string[]> {
  const dirsOrFiles = [
    path.join(cwd, ".switchbay", "engines"),
    path.join(Bun.env.HOME ?? process.env.HOME ?? cwd, ".switchbay", "engines"),
    ...String(Bun.env.SWITCHBAY_ENGINE_PATHS ?? "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ];

  const paths: string[] = [];
  for (const entry of dirsOrFiles) {
    const resolved = resolvePath(entry, cwd);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) {
        paths.push(resolved);
      } else if (stat.isDirectory()) {
        const children = await fs.readdir(resolved);
        paths.push(
          ...children
            .filter((child) => child.endsWith(".json") || child.endsWith(".engine.json"))
            .map((child) => path.join(resolved, child)),
        );
      }
    } catch {
      // Missing engine locations are normal.
    }
  }
  paths.push(...await engineBayManifestPaths());
  paths.push(...await pluginAssetPaths("engines", cwd));
  return [...new Set(paths)];
}

function createCreativeEngine(cwd: string): EngineManifest {
  const scriptPath = path.join(import.meta.dir, "creative-engine.ts");
  const command = (tool: string, args: string) => `bun ${shellQuote(scriptPath)} ${tool} ${args}`;
  return {
    id: "creative",
    name: "Creative Engine",
    description: "Local writing, naming, positioning, hooks, copy, critique, and content planning.",
    cwd,
    tools: [
      {
        name: "creative_brief",
        description: "Turn rough notes into a structured creative brief and save it under .switchbay/creative/briefs.",
        command: command("brief", "--notes {{notes}}"),
        required: ["notes"],
        parameters: { notes: { type: "string", description: "Rough notes, idea, or context." } },
      },
      {
        name: "creative_packet",
        description: "Build a richer creative packet with brief, positioning, names, hooks, draft copy, and a content calendar.",
        command: command("packet", "--brief {{brief}} --audience {{audience}} --format {{format}} --days {{days}}"),
        required: ["brief"],
        parameters: {
          brief: { type: "string", description: "Project, product, offer, or writing brief." },
          audience: { type: "string", description: "Target audience." },
          format: { type: "string", description: "Primary output format, such as post, email, landing, script, or announcement." },
          days: { type: "number", description: "Content calendar length, up to 31 days." },
        },
      },
      {
        name: "name_storm",
        description: "Generate naming routes from a brief.",
        command: command("name-storm", "--brief {{brief}} --count {{count}}"),
        required: ["brief"],
        parameters: {
          brief: { type: "string", description: "Naming brief or context." },
          count: { type: "number", description: "Number of name options." },
        },
      },
      {
        name: "positioning_routes",
        description: "Explore positioning angles from a brief.",
        command: command("positioning-routes", "--brief {{brief}}"),
        required: ["brief"],
        parameters: { brief: { type: "string", description: "Project, product, or offer brief." } },
      },
      {
        name: "hook_bank",
        description: "Generate hooks for a topic, audience, and format.",
        command: command("hook-bank", "--topic {{topic}} --audience {{audience}} --format {{format}}"),
        required: ["topic"],
        parameters: {
          topic: { type: "string", description: "Topic or campaign theme." },
          audience: { type: "string", description: "Target audience." },
          format: { type: "string", description: "Post, email, ad, script, or other format." },
        },
      },
      {
        name: "copy_draft",
        description: "Draft practical copy for a selected format and save it under .switchbay/creative/drafts.",
        command: command("copy-draft", "--brief {{brief}} --format {{format}}"),
        required: ["brief"],
        parameters: {
          brief: { type: "string", description: "Copy brief." },
          format: { type: "string", description: "Post, email, landing, product, bio, or announcement." },
        },
      },
      {
        name: "rewrite_voice",
        description: "Rewrite text toward a named voice. Reads .switchbay/creative/voices/<voice>.md when present.",
        command: command("rewrite-voice", "--text {{text}} --voice {{voice}}"),
        required: ["text"],
        parameters: {
          text: { type: "string", description: "Text to rewrite." },
          voice: { type: "string", description: "Voice name or direction." },
        },
      },
      {
        name: "tighten_copy",
        description: "Clean and tighten copy without changing the core idea.",
        command: command("tighten", "--text {{text}}"),
        required: ["text"],
        parameters: { text: { type: "string", description: "Text to tighten." } },
      },
      {
        name: "expand_idea",
        description: "Expand a rough idea into pillars, formats, and a next draft prompt.",
        command: command("expand-idea", "--idea {{idea}}"),
        required: ["idea"],
        parameters: { idea: { type: "string", description: "Rough idea to expand." } },
      },
      {
        name: "critique_copy",
        description: "Critique copy for clarity, specificity, CTA strength, and cringe risk.",
        command: command("critique", "--text {{text}}"),
        required: ["text"],
        parameters: { text: { type: "string", description: "Copy to critique." } },
      },
      {
        name: "content_calendar",
        description: "Turn a theme into a simple content calendar and save it under .switchbay/creative/drafts.",
        command: command("content-calendar", "--theme {{theme}} --days {{days}}"),
        required: ["theme"],
        parameters: {
          theme: { type: "string", description: "Theme, product, or campaign." },
          days: { type: "number", description: "Number of days, up to 31." },
        },
      },
      {
        name: "list_voices",
        description: "List local creative voice files.",
        command: command("list-voices", ""),
      },
      {
        name: "read_voice",
        description: "Read a local creative voice file.",
        command: command("read-voice", "--voice {{voice}}"),
        required: ["voice"],
        parameters: { voice: { type: "string", description: "Voice file name without .md." } },
      },
    ],
  };
}

function createWebEngine(cwd: string): EngineManifest {
  const scriptPath = path.join(import.meta.dir, "web-engine.ts");
  const command = (tool: string) => `bun ${shellQuote(scriptPath)} ${tool} --url {{url}}`;
  return {
    id: "web",
    name: "Web Engine",
    description: "Guarded explicit-URL web reads for current docs, release notes, pages, and source links.",
    cwd,
    tools: [
      {
        name: "web_fetch",
        description: "Fetch an explicit public HTTP(S) URL and return readable text with response metadata.",
        command: command("fetch"),
        required: ["url"],
        parameters: { url: { type: "string", description: "Public http or https URL to read." } },
      },
      {
        name: "web_headers",
        description: "Fetch response headers for an explicit public HTTP(S) URL.",
        command: command("headers"),
        required: ["url"],
        parameters: { url: { type: "string", description: "Public http or https URL to inspect." } },
      },
      {
        name: "web_links",
        description: "Extract normalized links from an explicit public HTTP(S) URL.",
        command: command("links"),
        required: ["url"],
        parameters: { url: { type: "string", description: "Public http or https URL to scan for links." } },
      },
    ],
  };
}

function createPlannerEngine(cwd: string): EngineManifest {
  const scriptPath = path.join(import.meta.dir, "planner-engine.ts");
  const command = (action: string, args = "") => `bun ${shellQuote(scriptPath)} ${action} ${args}`;
  return {
    id: "planner",
    name: "Planner Engine",
    description: "Durable workspace planning: create a task plan, inspect it, add work, and update progress.",
    cwd,
    tools: [
      { name: "create_plan", description: "Create or replace the active workspace plan. steps_json must be a JSON array of concise task titles.", command: command("create", "--objective {{objective}} --steps {{steps_json}}"), required: ["objective"], parameters: { objective: { type: "string", description: "Concrete goal the plan should accomplish." }, steps_json: { type: "string", description: "JSON array of task titles, e.g. [\"Inspect\",\"Implement\",\"Verify\"]." } } },
      { name: "show_plan", description: "Show the active workspace plan and each task's current state.", command: command("show") },
      { name: "add_task", description: "Append a focused task to the active plan.", command: command("add", "--task {{task}} --notes {{notes}}"), required: ["task"], parameters: { task: { type: "string", description: "Task title." }, notes: { type: "string", description: "Optional short context or acceptance check." } } },
      { name: "update_task", description: "Set a task state to todo, in_progress, done, or blocked. State changes make progress inspectable.", command: command("update", "--task_id {{task_id}} --status {{status}} --notes {{notes}}"), required: ["task_id", "status"], parameters: { task_id: { type: "string", description: "Task id from show_plan." }, status: { type: "string", description: "todo, in_progress, done, or blocked." }, notes: { type: "string", description: "Optional progress note or blocker." } } },
      { name: "clear_plan", description: "Clear the active workspace plan after the work is complete or deliberately abandoned.", command: command("clear") },
    ],
  };
}

async function discoverGumOpsEngine(cwd: string): Promise<EngineManifest | null> {
  const configured = [Bun.env.SWITCHBAY_GUMOPS_PATH, Bun.env.GUMOPS_PATH]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [
    ...configured,
    path.join(cwd, "GumOps"),
    path.join(cwd, "gumops"),
    path.join(cwd, "..", "GumOps"),
    path.join(cwd, "..", "gumops"),
    "/tmp/GumOps",
  ];

  for (const candidate of candidates) {
    const gumOpsPath = resolvePath(candidate, cwd);
    if (!existsSync(path.join(gumOpsPath, "gumgent.py"))) continue;
    const tools: EngineTool[] = [
      { name: "tools", description: "List GumOps tools.", command: "python3 gumgent.py tools list" },
      { name: "query", description: "Ask the GumOps agent.", command: "python3 gumgent.py query {{query}}", required: ["query"], parameters: { query: { type: "string", description: "Question or instruction." } } },
      { name: "query_no_tools", description: "Ask GumOps without its tool loop.", command: "python3 gumgent.py query --no-tools {{query}}", required: ["query"], parameters: { query: { type: "string", description: "Question or instruction." } } },
      { name: "refresh", description: "Refresh GumOps working memory.", command: "python3 gumgent.py refresh-memory" },
      { name: "memory_list", description: "List GumOps memory keys.", command: "python3 gumgent.py memory list" },
      { name: "memory_get", description: "Read a GumOps memory item.", command: "python3 gumgent.py memory get {{key}}", required: ["key"], parameters: { key: { type: "string", description: "Memory key." } } },
      { name: "memory_add", description: "Add or update GumOps memory.", command: "python3 gumgent.py memory add {{key}} {{value}}", required: ["key", "value"], parameters: { key: { type: "string", description: "Memory key." }, value: { type: "string", description: "Memory value." } } },
      { name: "memory_find", description: "Search GumOps memory.", command: "python3 gumgent.py memory find {{query}}", required: ["query"], parameters: { query: { type: "string", description: "Search text." } } },
      { name: "products", description: "List Gumroad products.", command: "python3 -c \"from model_tools import list_gumroad_products; print(list_gumroad_products(page={{page}}))\"", parameters: { page: { type: "number", description: "Products page." } } },
      { name: "sales_summary", description: "Return Gumroad sales summary.", command: "python3 -c \"from model_tools import gumroad_sales_summary; print(gumroad_sales_summary())\"" },
      { name: "account_info", description: "Return Gumroad seller account info.", command: "python3 -c \"from model_tools import get_gumroad_account_info; print(get_gumroad_account_info())\"" },
      { name: "refund_sale", description: "Refund a Gumroad sale.", command: "python3 -c \"from model_tools import refund_gumroad_sale; print(refund_gumroad_sale({{sale_id}}, amount={{amount}}))\"", required: ["sale_id"], parameters: { sale_id: { type: "string", description: "Sale ID." }, amount: { type: "number", description: "Optional amount." } }, approval: "always", approval_reason: "Refund a Gumroad sale." },
    ];

    if (existsSync(path.join(gumOpsPath, "engine_harnesses", "fbgent.py"))) {
      tools.push(
        {
          name: "facebook_get",
          description: "Run a read-only Facebook Graph GET through GumOps.",
          command: "python3 engine_harnesses/fbgent.py get {{path}} --fields {{fields}}",
          required: ["path", "fields"],
          parameters: {
            path: { type: "string", description: "Graph path such as me or PAGE_ID/posts." },
            fields: { type: "string", description: "Comma-separated fields." },
          },
        },
        {
          name: "facebook_page_insights",
          description: "Fetch Facebook page insights through GumOps.",
          command: "python3 engine_harnesses/fbgent.py page-insights {{page_id}} --metrics {{metrics}} --period {{period}}",
          required: ["page_id", "metrics", "period"],
          parameters: {
            page_id: { type: "string", description: "Facebook page ID." },
            metrics: { type: "string", description: "Comma-separated metrics." },
            period: { type: "string", description: "Insights period, such as day." },
          },
        },
      );
    }

    if (existsSync(path.join(gumOpsPath, "engine_harnesses", "shopgent.py"))) {
      tools.push(
        { name: "shopify_shop_info", description: "Read configured Shopify shop info through GumOps.", command: "python3 engine_harnesses/shopgent.py shop-info" },
        {
          name: "shopify_products",
          description: "List Shopify products through GumOps.",
          command: "python3 engine_harnesses/shopgent.py products --limit {{limit}} --published-status {{published_status}}",
          required: ["limit", "published_status"],
          parameters: {
            limit: { type: "number", description: "Maximum products to return." },
            published_status: { type: "string", description: "Published status filter, defaults to any." },
          },
        },
        {
          name: "shopify_product",
          description: "Read a Shopify product by ID through GumOps.",
          command: "python3 engine_harnesses/shopgent.py product {{product_id}}",
          required: ["product_id"],
          parameters: { product_id: { type: "string", description: "Shopify product ID." } },
        },
        {
          name: "shopify_orders",
          description: "List Shopify orders through GumOps.",
          command: "python3 engine_harnesses/shopgent.py orders --limit {{limit}} --status {{status}}",
          required: ["limit", "status"],
          parameters: {
            limit: { type: "number", description: "Maximum orders to return." },
            status: { type: "string", description: "Order status filter, defaults to any." },
          },
        },
        {
          name: "shopify_order",
          description: "Read a Shopify order by ID through GumOps.",
          command: "python3 engine_harnesses/shopgent.py order {{order_id}}",
          required: ["order_id"],
          parameters: { order_id: { type: "string", description: "Shopify order ID." } },
        },
        { name: "shopify_insights", description: "Read basic Shopify shop insights through GumOps.", command: "python3 engine_harnesses/shopgent.py insights" },
      );
    }

    return {
      id: "gumops",
      name: "GumOps",
      description: "Local Gumroad operations, GumOps memory, and optional commerce/social harnesses.",
      cwd: gumOpsPath,
      approval: { always: ["refund"] },
      tools,
    };
  }

  return null;
}

async function discoverThinkapseEngine(cwd: string): Promise<EngineManifest | null> {
  const configured = [Bun.env.SWITCHBAY_THINKAPSE_PATH, Bun.env.THINKAPSE_PATH]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [
    ...configured,
    path.join(cwd, "thinkapse"),
    path.join(cwd, "Thinkapse"),
    path.join(cwd, "..", "thinkapse"),
    path.join(cwd, "..", "Thinkapse"),
    "/tmp/thinkapse",
  ];

  for (const candidate of candidates) {
    const thinkapsePath = resolvePath(candidate, cwd);
    if (!existsSync(path.join(thinkapsePath, "harness.py"))) continue;
    return {
      id: "thinkapse",
      name: "Thinkapse",
      description: "Local Notion capture, triage, route preview, and workspace agent harness.",
      cwd: thinkapsePath,
      approval: { always: ["route_apply", "mark_processed", "rollback", "delete", "create", "edit", "apply"] },
      tools: [
        {
          name: "capture",
          description: "Capture text to the Thinkapse Notion inbox.",
          command: "python3 harness.py capture {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "Text to capture." } },
        },
        {
          name: "capture_force",
          description: "Capture text to the Thinkapse inbox while skipping duplicate checks.",
          command: "python3 harness.py capture --force {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "Text to capture." } },
          approval: "always",
          approval_reason: "Force-capture writes to Notion and skips Thinkapse duplicate checks.",
        },
        {
          name: "query_unprocessed",
          description: "List unprocessed Thinkapse inbox pages.",
          command: "python3 harness.py query --limit {{limit}}",
          parameters: { limit: { type: "number", description: "Maximum rows to return." } },
        },
        {
          name: "query_named",
          description: "Run a named Thinkapse inbox query.",
          command: "python3 harness.py query --query {{query}} --limit {{limit}}",
          required: ["query"],
          parameters: {
            query: { type: "string", description: "Saved or built-in query key." },
            limit: { type: "number", description: "Maximum rows to return." },
          },
        },
        {
          name: "query_category",
          description: "List Thinkapse inbox pages by category.",
          command: "python3 harness.py query --category {{category}} --limit {{limit}}",
          required: ["category"],
          parameters: {
            category: { type: "string", description: "Category filter." },
            limit: { type: "number", description: "Maximum rows to return." },
          },
        },
        {
          name: "triage",
          description: "Preview Thinkapse route suggestions for unprocessed inbox rows.",
          command: "python3 harness.py triage",
        },
        {
          name: "route_preview",
          description: "Preview Thinkapse routing without writing changes.",
          command: "python3 harness.py clean --dry-run",
        },
        {
          name: "route_apply",
          description: "Route unprocessed Thinkapse inbox rows.",
          command: "python3 harness.py clean",
          approval: "always",
          approval_reason: "Apply Thinkapse routing changes in Notion.",
        },
        {
          name: "mark_processed",
          description: "Mark a Thinkapse inbox page processed.",
          command: "python3 harness.py mark-processed {{page_id}}",
          required: ["page_id"],
          parameters: { page_id: { type: "string", description: "Notion page id." } },
          approval: "always",
          approval_reason: "Mark a Notion inbox page as processed.",
        },
        {
          name: "agents",
          description: "List Thinkapse route and workflow agents.",
          command: "python3 harness.py agents",
        },
        {
          name: "agent_show",
          description: "Show one Thinkapse agent definition.",
          command: "python3 harness.py agent show {{key}}",
          required: ["key"],
          parameters: { key: { type: "string", description: "Agent key." } },
        },
        {
          name: "agent_validate",
          description: "Validate Thinkapse workspace agent definitions.",
          command: "python3 harness.py agent validate",
        },
        {
          name: "parse_notion_id",
          description: "Extract a compact Notion id from a Notion URL or raw id.",
          command: "python3 harness.py id {{value}} --compact",
          required: ["value"],
          parameters: { value: { type: "string", description: "Notion URL or id." } },
        },
        {
          name: "suno_capture",
          description: "Capture a Suno prompt through Thinkapse.",
          command: "python3 harness.py suno {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "Suno prompt or idea." } },
        },
        {
          name: "hellhound_capture",
          description: "Capture a HellHound content idea through Thinkapse.",
          command: "python3 harness.py hellhound {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "HellHound content idea." } },
        },
        {
          name: "msc_product_capture",
          description: "Capture an MSC product idea through Thinkapse.",
          command: "python3 harness.py msc product {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "MSC product idea." } },
        },
        {
          name: "msc_order_capture",
          description: "Capture an MSC order or fulfillment note through Thinkapse.",
          command: "python3 harness.py msc order {{text}}",
          required: ["text"],
          parameters: { text: { type: "string", description: "MSC order or fulfillment note." } },
        },
        {
          name: "msc_route_preview",
          description: "Preview MSC-specific Thinkapse routing.",
          command: "python3 harness.py msc route --dry-run",
        },
        {
          name: "memory_status",
          description: "Show Thinkapse agent memory status.",
          command: "python3 harness.py memory status",
        },
        {
          name: "memory_context",
          description: "Show Thinkapse memory context for an agent.",
          command: "python3 harness.py memory context {{agent_key}} --limit {{limit}}",
          required: ["agent_key"],
          parameters: {
            agent_key: { type: "string", description: "Agent key." },
            limit: { type: "number", description: "Recent event limit." },
          },
        },
      ],
    };
  }

  return null;
}

function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      return key === "page" ? "1" : "None";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return shellQuote(String(value));
  });
}

function engineRequiresApproval(engine: EngineManifest, tool: EngineTool, command: string): boolean {
  const haystack = `${tool.name} ${command}`.toLowerCase();
  return (engine.approval?.always ?? []).some((needle) => haystack.includes(needle.toLowerCase()));
}

function resolvePath(value: string, base: string): string {
  const expanded = value.replace(/^~(?=\/|$)/, Bun.env.HOME ?? process.env.HOME ?? "");
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(base, expanded);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
