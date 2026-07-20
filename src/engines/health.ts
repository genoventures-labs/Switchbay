import { platform } from "node:os";
import { join } from "node:path";
import { loadEngineRegistry, type EngineManifest, type EngineTool } from "./registry";

// Known system tools → brew / apt package names
const BREW_PACKAGES: Record<string, string> = {
  tesseract: "tesseract",
  ffmpeg: "ffmpeg",
  convert: "imagemagick",
  imagemagick: "imagemagick",
  ruby: "ruby",
  node: "node",
  neo4j: "neo4j",
  dot: "graphviz",
  graphviz: "graphviz",
  pandoc: "pandoc",
  wkhtmltopdf: "wkhtmltopdf",
  poppler: "poppler",
  pdftotext: "poppler",
};
const APT_PACKAGES: Record<string, string> = {
  tesseract: "tesseract-ocr",
  ffmpeg: "ffmpeg",
  convert: "imagemagick",
  imagemagick: "imagemagick",
  ruby: "ruby",
  node: "nodejs",
  dot: "graphviz",
  graphviz: "graphviz",
  pandoc: "pandoc",
  pdftotext: "poppler-utils",
};

export type FixStep = {
  label: string;
  ok: boolean;
  output?: string;
};

export type EngineFixResult = {
  id: string;
  name: string;
  steps: FixStep[];
  fixed: boolean;
};

export async function fixEngines(results: EngineHealthResult[], cwd = process.cwd()): Promise<EngineFixResult[]> {
  const registry = await loadEngineRegistry(cwd);
  const broken = results.filter((r) => r.status !== "ok");
  return Promise.all(
    broken.map((result) => {
      const manifest = registry.engines.find((e) => e.id === result.id);
      return fixEngine(result, manifest?.cwd ?? cwd);
    }),
  );
}

async function fixEngine(result: EngineHealthResult, engineCwd: string): Promise<EngineFixResult> {
  const steps: FixStep[] = [];
  const isMac = platform() === "darwin";

  // Venv-based engines (.venv/bin/python missing) — create venv first, then pip into it
  const venvTools = result.tools.filter((t) => t.status === "missing" && t.executable?.includes(".venv/"));
  if (venvTools.length > 0) {
    const venvStep = await runFix(["python3", "-m", "venv", ".venv"], engineCwd, "python3 -m venv .venv");
    steps.push(venvStep);
    if (venvStep.ok) {
      const reqPath = join(engineCwd, "requirements.txt");
      if (await Bun.file(reqPath).exists()) {
        steps.push(await runFix([".venv/bin/pip", "install", "-r", "requirements.txt"], engineCwd, ".venv/bin/pip install -r requirements.txt"));
      }
    }
    // Don't fall through to system tool check for venv paths
    return { id: result.id, name: result.name, steps, fixed: steps.length > 0 && steps.every((s) => s.ok) };
  }

  // Python package deps (requirements.txt) — with PEP 668 fallback on macOS
  const reqPath = join(engineCwd, "requirements.txt");
  if (await Bun.file(reqPath).exists()) {
    const step = await runFix(["pip3", "install", "-r", "requirements.txt"], engineCwd, "pip3 install -r requirements.txt");
    if (!step.ok && (step.output?.includes("externally-managed") || step.output?.includes("PEP 668"))) {
      const fallback = await runFix(
        ["pip3", "install", "--break-system-packages", "-r", "requirements.txt"],
        engineCwd,
        "pip3 install --break-system-packages -r requirements.txt",
      );
      steps.push(fallback);
    } else {
      steps.push(step);
    }
  }

  // Node deps
  const pkgPath = join(engineCwd, "package.json");
  if (await Bun.file(pkgPath).exists()) {
    steps.push(await runFix(["bun", "install"], engineCwd, "bun install"));
  }

  // Ruby deps
  const gemfilePath = join(engineCwd, "Gemfile");
  if (await Bun.file(gemfilePath).exists()) {
    steps.push(await runFix(["bundle", "install"], engineCwd, "bundle install"));
  }

  // Missing system executables (skip venv paths — already handled above)
  const missingExecs = [
    ...new Set(
      result.tools
        .filter((t) => t.status === "missing" && t.executable && !t.executable.includes(".venv/"))
        .map((t) => t.executable!.split("/").pop()!),
    ),
  ];
  for (const exec of missingExecs) {
    if (isMac && BREW_PACKAGES[exec]) {
      steps.push(await runFix(["brew", "install", BREW_PACKAGES[exec]!], process.cwd(), `brew install ${BREW_PACKAGES[exec]}`));
    } else if (!isMac && APT_PACKAGES[exec]) {
      steps.push(await runFix(["sudo", "apt-get", "install", "-y", APT_PACKAGES[exec]!], process.cwd(), `apt-get install ${APT_PACKAGES[exec]}`));
    } else {
      steps.push({ label: `${exec} — no known package`, ok: false });
    }
  }

  return {
    id: result.id,
    name: result.name,
    steps,
    fixed: steps.length > 0 && steps.every((s) => s.ok),
  };
}

async function runFix(cmd: string[], cwd: string, label: string): Promise<FixStep> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const ok = code === 0;
    const output = (stdout + stderr).trim().split("\n").filter((l) => l.trim()).pop() ?? "";
    return { label, ok, output: output.slice(0, 120) };
  } catch (err) {
    return { label, ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export type ToolHealth = {
  name: string;
  executable: string | null;
  executableFound: boolean;
  status: "ok" | "warn" | "missing";
};

export type EngineHealthResult = {
  id: string;
  name: string;
  toolCount: number;
  tools: ToolHealth[];
  doctorOutput: string | null;
  doctorLines: string[];
  doctorOk: boolean | null;
  status: "ok" | "warn" | "fail";
};

export async function healthCheckEngines(cwd = process.cwd()): Promise<EngineHealthResult[]> {
  const registry = await loadEngineRegistry(cwd);
  return Promise.all(registry.engines.map((engine) => healthCheckEngine(engine, cwd)));
}

async function healthCheckEngine(engine: EngineManifest, cwd: string): Promise<EngineHealthResult> {
  const engineCwd = engine.cwd ?? cwd;
  const tools: ToolHealth[] = await Promise.all(engine.tools.map((tool) => checkTool(tool, engineCwd)));

  const missingCount = tools.filter((t) => t.status === "missing").length;
  const warnCount = tools.filter((t) => t.status === "warn").length;

  // Run doctor if available and executable is found
  let doctorOutput: string | null = null;
  let doctorOk: boolean | null = null;
  const doctorTool = engine.tools.find((t) => t.name === "doctor");
  if (doctorTool) {
    const doctorHealth = tools.find((t) => t.name === "doctor");
    if (doctorHealth?.executableFound) {
      const rendered = renderTemplate(doctorTool.command, {});
      const result = await runWithTimeout(rendered, engineCwd, 10_000);
      doctorOk = result.exitCode === 0;
      const raw = (result.stdout + result.stderr).trim();
      doctorOutput = stripAnsi(raw).slice(0, 2000);
      // Override doctorOk if JSON parsing finds a required-but-unavailable dep
      if (doctorOk) {
        const parsed = parseDoctorOutput(doctorOutput);
        if (parsed.hasFailure) doctorOk = false;
      }
    }
  }

  const status: EngineHealthResult["status"] =
    missingCount === tools.length && tools.length > 0
      ? "fail"
      : missingCount > 0 || warnCount > 0 || doctorOk === false
        ? "warn"
        : "ok";

  return {
    id: engine.id,
    name: engine.name,
    toolCount: engine.tools.length,
    tools,
    doctorOutput,
    doctorLines: parseDoctorOutput(doctorOutput).lines,
    doctorOk,
    status,
  };
}

async function checkTool(tool: EngineTool, cwd: string): Promise<ToolHealth> {
  const executable = extractExecutable(tool.command);
  if (!executable) return { name: tool.name, executable: null, executableFound: false, status: "warn" };

  const found = await resolveExecutable(executable, cwd);
  return {
    name: tool.name,
    executable,
    executableFound: found,
    status: found ? "ok" : "missing",
  };
}

function extractExecutable(command: string): string | null {
  // Strip template placeholders, take the first token
  const cleaned = command.replace(/\{\{[^}]+\}\}/g, "").trim();
  const first = cleaned.split(/\s+/)[0];
  return first || null;
}

async function resolveExecutable(executable: string, cwd: string): Promise<boolean> {
  // Absolute or relative path
  if (executable.startsWith("/") || executable.startsWith("./") || executable.startsWith("../")) {
    const abs = executable.startsWith("/") ? executable : `${cwd}/${executable}`;
    return Bun.file(abs).exists();
  }
  // Which-style PATH lookup
  const which = Bun.which(executable);
  return which !== null;
}

async function runWithTimeout(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["sh", "-c", command], { cwd, stdout: "pipe", stderr: "pipe" });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, timeoutMs),
    );
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      timeout,
    ]);
    return { exitCode: exitCode ?? 1, stdout, stderr };
  } catch {
    return { exitCode: 1, stdout: "", stderr: "" };
  }
}

function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(args[key] ?? ""));
}

const NOISE_LINE = /^[=\-*#~_]{2,}$|^\s*\[.+\]\s*$|^ok$|^done$|^success$/i;
const MAX_DOCTOR_LINES = 8;
const SKIP_KEYS = new Set(["engine", "id", "name"]);

export type DoctorParseResult = { lines: string[]; hasFailure: boolean };

export function parseDoctorOutput(output: string | null): DoctorParseResult {
  if (!output) return { lines: [], hasFailure: false };

  // Try JSON first
  const trimmed = output.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      return parseDoctorJson(data);
    } catch {
      // fall through to text parsing
    }
  }

  // Plain text
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE_LINE.test(l))
    .slice(0, MAX_DOCTOR_LINES);
  return { lines, hasFailure: false };
}

function parseDoctorJson(data: unknown): DoctorParseResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { lines: [JSON.stringify(data).slice(0, 80)], hasFailure: false };
  }
  const lines: string[] = [];
  let hasFailure = false;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue;
    const label = capitalize(key.replace(/_/g, " "));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const available = obj.available ?? obj.connected ?? obj.reachable ?? obj.writable ?? obj.installed;
      const version = obj.version ?? obj.v ?? null;
      const required = obj.required ?? false;
      const count = obj.count ?? obj.nodes ?? obj.relationships ?? null;
      if (available === false) {
        hasFailure = hasFailure || Boolean(required);
        lines.push(`${required ? "✗" : "○"} ${label} unavailable`);
      } else if (typeof count === "number") {
        lines.push(`${label}: ${count.toLocaleString()}`);
      } else if (version) {
        lines.push(`${label} ${version}`);
      } else if (available === true) {
        lines.push(`${label} available`);
      } else {
        const summary = Object.entries(obj)
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        if (summary) lines.push(`${label}: ${summary}`);
      }
    } else if (typeof value === "string" && value.trim()) {
      lines.push(`${label} ${value}`);
    } else if (typeof value === "number") {
      lines.push(`${label}: ${value.toLocaleString()}`);
    } else if (typeof value === "boolean") {
      if (!value) { hasFailure = true; lines.push(`✗ ${label} unavailable`); }
    }
  }
  return { lines: lines.slice(0, MAX_DOCTOR_LINES), hasFailure };
}

// Keep old export for callers that only need lines
export function parseDoctorLines(output: string | null): string[] {
  return parseDoctorOutput(output).lines;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// eslint-disable-next-line no-control-regex
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
