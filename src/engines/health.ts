import { platform } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { loadEngineRegistry, type EngineManifest, type EngineTool } from "./registry";

// Python stdlib module names — not installable via pip
const PYTHON_STDLIB = new Set([
  "abc","argparse","ast","asyncio","base64","binascii","builtins","cgi","cmd","code",
  "collections","concurrent","contextlib","copy","csv","ctypes","dataclasses",
  "datetime","decimal","difflib","email","enum","errno","faulthandler","fileinput",
  "fnmatch","fractions","ftplib","functools","gc","getopt","getpass","gettext",
  "glob","gzip","hashlib","heapq","hmac","html","http","importlib","inspect",
  "io","ipaddress","itertools","json","keyword","linecache","locale","logging",
  "lzma","math","mimetypes","multiprocessing","numbers","operator","os","pathlib",
  "pickle","platform","pprint","queue","random","re","shlex","shutil","signal",
  "socket","socketserver","sqlite3","ssl","stat","statistics","string","struct",
  "subprocess","sys","tarfile","tempfile","textwrap","threading","time","timeit",
  "tkinter","traceback","types","typing","unicodedata","unittest","urllib","uuid",
  "venv","warnings","weakref","xml","xmlrpc","zipfile","zipimport","zlib",
  "__future__","_thread","atexit","bisect","calendar","cmath","compileall",
  "configparser","copyreg","dbm","dis","doctest","encodings","filecmp","formatter",
  "grp","imaplib","imghdr","imp","lib2to3","mailbox",
  "marshal","mmap","modulefinder","netrc","nntplib","nis","ntpath","optparse",
  "parser","pdb","pickletools","pipes","pkgutil","poplib","posix","posixpath",
  "pstats","pty","pwd","py_compile","pyclbr","pydoc","readline","reprlib",
  "rlcompleter","runpy","sched","secrets","select","selectors","shelve","smtpd",
  "smtplib","sndhdr","spwd","sre_compile","sre_constants","sre_parse","stringprep",
  "sunau","symtable","sysconfig","syslog","tabnanny","telnetlib","termios","test",
  "token","tokenize","trace","tracemalloc","tty","turtle","turtledemo",
  "uu","wave","webbrowser","wsgiref","xdrlib","zipapp",
]);

// Common import name → pip package name mismatches
const PIP_ALIASES: Record<string, string> = {
  cv2: "opencv-python",
  PIL: "Pillow",
  sklearn: "scikit-learn",
  skimage: "scikit-image",
  bs4: "beautifulsoup4",
  yaml: "PyYAML",
  dotenv: "python-dotenv",
  google: "google-cloud",
  dateutil: "python-dateutil",
  Crypto: "pycryptodome",
  gi: "PyGObject",
  wx: "wxPython",
  gtk: "PyGTK",
  OpenGL: "PyOpenGL",
  usb: "pyusb",
  serial: "pyserial",
  magic: "python-magic",
  docx: "python-docx",
  pptx: "python-pptx",
  odf: "odfpy",
  boto3: "boto3",
  botocore: "botocore",
  azure: "azure",
  attr: "attrs",
  jwt: "PyJWT",
  cryptography: "cryptography",
  nacl: "PyNaCl",
  paramiko: "paramiko",
  fabric: "fabric",
  invoke: "invoke",
  celery: "celery",
  kombu: "kombu",
  billiard: "billiard",
  aiohttp: "aiohttp",
  httpx: "httpx",
  starlette: "starlette",
  fastapi: "fastapi",
  uvicorn: "uvicorn",
  gunicorn: "gunicorn",
  flask: "Flask",
  django: "Django",
  sqlalchemy: "SQLAlchemy",
  alembic: "alembic",
  psycopg2: "psycopg2-binary",
  pymysql: "PyMySQL",
  pymongo: "pymongo",
  redis: "redis",
  elasticsearch: "elasticsearch",
  pydantic: "pydantic",
  typer: "typer",
  click: "click",
  rich: "rich",
  tqdm: "tqdm",
  loguru: "loguru",
  pytest: "pytest",
  hypothesis: "hypothesis",
  numpy: "numpy",
  pandas: "pandas",
  matplotlib: "matplotlib",
  seaborn: "seaborn",
  plotly: "plotly",
  scipy: "scipy",
  sympy: "sympy",
  statsmodels: "statsmodels",
  nltk: "nltk",
  spacy: "spacy",
  transformers: "transformers",
  torch: "torch",
  torchvision: "torchvision",
  tensorflow: "tensorflow",
  keras: "keras",
  xgboost: "xgboost",
  lightgbm: "lightgbm",
  catboost: "catboost",
  networkx: "networkx",
  shapely: "shapely",
  fiona: "fiona",
  geopandas: "geopandas",
  pyproj: "pyproj",
  PIL: "Pillow",
  imageio: "imageio",
  openpyxl: "openpyxl",
  xlrd: "xlrd",
  xlwt: "xlwt",
  lxml: "lxml",
  arrow: "arrow",
  pendulum: "pendulum",
  pytz: "pytz",
  tzlocal: "tzlocal",
  chardet: "chardet",
  charset_normalizer: "charset-normalizer",
  certifi: "certifi",
  urllib3: "urllib3",
  requests: "requests",
  tweepy: "tweepy",
  slack_sdk: "slack-sdk",
  anthropic: "anthropic",
  openai: "openai",
};

// ── SLM fallback ─────────────────────────────────────────────────────────────

type LocalModelCandidate = { apiBase: string; model: string; score: number; lane: string };

function scoreModelName(name: string): number {
  const lower = name.toLowerCase();
  const match = lower.match(/(\d+(\.\d+)?)\s*b\b/);
  if (match) return parseFloat(match[1]!);
  if (lower.includes("large")) return 10;
  if (lower.includes("medium")) return 5;
  if (lower.includes("small")) return 2;
  return 4; // unknown — assume modest
}

async function probeOpenAiCompat(apiBase: string, lane: string): Promise<LocalModelCandidate[]> {
  try {
    const res = await fetch(`${apiBase}/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ id?: string }> };
    return (data.data ?? []).flatMap((m) => {
      const id = m.id?.trim();
      if (!id) return [];
      return [{ apiBase, model: id, score: scoreModelName(id), lane }];
    });
  } catch { return []; }
}

async function probeOllama(apiBase: string): Promise<LocalModelCandidate[]> {
  try {
    const res = await fetch(`${apiBase}/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name?: string; model?: string; details?: { parameter_size?: string } }> };
    const openAiBase = apiBase.replace(/\/api$/, "") + "/v1";
    return (data.models ?? []).flatMap((m) => {
      const id = (m.model ?? m.name ?? "").trim();
      if (!id) return [];
      const paramSize = m.details?.parameter_size ?? "";
      const score = paramSize ? scoreModelName(paramSize) : scoreModelName(id);
      return [{ apiBase: openAiBase, model: id, score, lane: "ollama" }];
    });
  } catch { return []; }
}

export async function findBestLocalModel(): Promise<LocalModelCandidate | null> {
  const results = await Promise.all([
    probeOpenAiCompat("http://localhost:9379/v1", "litert"),
    probeOllama("http://localhost:11434/api"),
    probeOpenAiCompat("http://localhost:8080/v1", "llama-cpp"),
    probeOpenAiCompat("http://localhost:1234/v1", "mlx"),
  ]);
  const all = results.flat();
  if (!all.length) return null;
  return all.sort((a, b) => b.score - a.score)[0]!;
}

async function inferRequirementsWithSLM(dir: string): Promise<{ packages: string[]; model: string; lane: string } | null> {
  const candidate = await findBestLocalModel();
  if (!candidate) return null;

  // Read .py files (cap at ~8000 chars total to stay within small context windows)
  const sources: string[] = [];
  let totalChars = 0;
  function collectPyFiles(d: string, depth = 0) {
    if (depth > 2 || totalChars > 8000) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__pycache__") {
          collectPyFiles(join(d, entry.name), depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".py") && totalChars < 8000) {
          const src = readFileSync(join(d, entry.name), "utf-8").slice(0, 2000);
          sources.push(`--- ${entry.name} ---\n${src}`);
          totalChars += src.length;
        }
      }
    } catch { /* skip */ }
  }
  collectPyFiles(dir);
  if (!sources.length) return null;

  const prompt = [
    "You are a Python dependency analyzer.",
    "List ONLY the pip package names required to install the following Python source files.",
    "Rules: one package name per line, no version numbers, no explanations, no markdown.",
    "Only include packages available on PyPI — skip local modules and stdlib.",
    "",
    sources.join("\n\n"),
  ].join("\n");

  try {
    const res = await fetch(`${candidate.apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-local" },
      body: JSON.stringify({
        model: candidate.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 256,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const packages = text
      .split("\n")
      .map((l) => l.trim().replace(/^[-*•]\s*/, "").replace(/[`'"]/g, "").split(/[=<>!]/)[0]!.trim())
      .filter((l) => l.length > 0 && l.length < 60 && /^[a-zA-Z][\w\-.]*$/.test(l) && !PYTHON_STDLIB.has(l));
    return packages.length ? { packages: [...new Set(packages)].sort(), model: candidate.model, lane: candidate.lane } : null;
  } catch { return null; }
}

// Scan a directory for third-party Python imports, return sorted pip package names
function inferPythonRequirements(dir: string): string[] {
  const importedModules = new Set<string>();
  // Collect local module names (dirs with __init__.py or bare .py files) to exclude
  const localModules = new Set<string>();
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) localModules.add(entry.name);
      else if (entry.isFile() && entry.name.endsWith(".py")) localModules.add(entry.name.slice(0, -3));
    }
  } catch { /* ignore */ }

  function scanDir(d: string, depth = 0) {
    if (depth > 3) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__pycache__" && entry.name !== "node_modules") {
          scanDir(join(d, entry.name), depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".py")) {
          const src = readFileSync(join(d, entry.name), "utf-8");
          for (const line of src.split("\n")) {
            // `import X`, `import X as Y`, `import X, Y as Z`
            const importMatch = line.match(/^\s*import\s+(.+)/);
            // `from X import ...`, `from X.Y import ...`
            const fromMatch = line.match(/^\s*from\s+([\w.]+)\s+import/);
            if (importMatch) {
              for (const segment of importMatch[1]!.split(",")) {
                // strip `as alias` and whitespace, take top-level module
                const mod = segment.trim().replace(/\s+as\s+\w+$/, "").trim().split(".")[0]!;
                if (mod) importedModules.add(mod);
              }
            } else if (fromMatch) {
              const mod = fromMatch[1]!.split(".")[0]!;
              if (mod) importedModules.add(mod);
            }
          }
        }
      }
    } catch { /* unreadable dir */ }
  }
  scanDir(dir);
  const packages = new Set<string>();
  for (const mod of importedModules) {
    if (!mod || PYTHON_STDLIB.has(mod) || localModules.has(mod)) continue;
    packages.add(PIP_ALIASES[mod] ?? mod);
  }
  return [...packages].sort();
}

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

  // Venv-based engines — executable contains a .venv/ path segment.
  // The venv may live in a subdirectory (e.g. engines/Python/Gumroad/.venv),
  // so we extract the full venv path from the first missing tool's executable
  // and resolve everything relative to that subdirectory.
  const venvTools = result.tools.filter((t) => t.status === "missing" && t.executable?.includes(".venv/"));
  if (venvTools.length > 0) {
    // Extract the venv root: everything up to and including ".venv"
    const sampleExec = venvTools[0]!.executable!;
    const venvSegment = sampleExec.slice(0, sampleExec.indexOf(".venv") + ".venv".length);
    const venvAbs = venvSegment.startsWith("/") ? venvSegment : join(engineCwd, venvSegment);
    const installDir = join(venvAbs, ".."); // sibling directory containing requirements.txt

    const venvRel = venvSegment.startsWith("/") ? venvAbs : venvSegment;
    const venvStep = await runFix(["python3", "-m", "venv", venvRel], engineCwd, `python3 -m venv ${venvRel}`);
    steps.push(venvStep);

    if (venvStep.ok) {
      const pipBin = join(venvAbs, "bin", "pip");
      // Look for requirements.txt in the install dir, then fall back to engineCwd
      const reqCandidates = [join(installDir, "requirements.txt"), join(engineCwd, "requirements.txt")];
      const reqPath = reqCandidates.find((p) => Bun.file(p).size > 0) ?? null;

      const scanDir = installDir !== engineCwd ? installDir : engineCwd;
      let resolvedReqPath = reqPath;
      let generatedReqPath: string | null = null;

      if (!resolvedReqPath) {
        // No requirements.txt found — scan the engine source for third-party imports
        const packages = inferPythonRequirements(scanDir);
        if (packages.length > 0) {
          generatedReqPath = join(scanDir, "requirements.txt");
          try {
            await Bun.write(generatedReqPath, packages.join("\n") + "\n");
            steps.push({ label: `Generated requirements.txt (${packages.length} package${packages.length === 1 ? "" : "s"}: ${packages.slice(0, 5).join(", ")}${packages.length > 5 ? "…" : ""})`, ok: true });
            resolvedReqPath = generatedReqPath;
          } catch (err) {
            steps.push({ label: `Could not write requirements.txt: ${err instanceof Error ? err.message : String(err)}`, ok: false });
          }
        } else {
          steps.push({ label: "No third-party imports detected — skipped pip install", ok: true });
        }
      }

      if (resolvedReqPath) {
        const pipLabel = `${join(venvRel, "bin", "pip")} install -r requirements.txt`;
        const pipStep = await runFix([pipBin, "install", "-r", resolvedReqPath], engineCwd, pipLabel);

        // If pip failed and we own the file, strip packages it couldn't find and retry once
        if (!pipStep.ok && generatedReqPath) {
          const badPkgs = new Set<string>();
          const rawOutput = pipStep.output ?? "";
          for (const match of rawOutput.matchAll(/No matching distribution found for (\S+)/gi)) {
            badPkgs.add(match[1]!.toLowerCase());
          }
          const existing = await Bun.file(generatedReqPath).text().catch(() => "");
          const cleaned = existing.split("\n").filter((line) => {
            const pkg = line.trim().toLowerCase();
            return pkg && !badPkgs.has(pkg);
          });
          if (badPkgs.size > 0) {
            const cleaned2 = cleaned.filter((line) => !badPkgs.has(line.trim().toLowerCase()));
            steps.push({ label: `Removed ${badPkgs.size} unknown package${badPkgs.size === 1 ? "" : "s"}: ${[...badPkgs].join(", ")}`, ok: true });

            if (cleaned2.length > 0) {
              await Bun.write(generatedReqPath, cleaned2.join("\n") + "\n");
              const retryStep = await runFix([pipBin, "install", "-r", generatedReqPath], engineCwd, `${pipLabel} (retry)`);
              steps.push(retryStep);
            } else {
              // Static scan came up empty after stripping — try SLM fallback
              steps.push({ label: "Static scan exhausted — trying local model inference…", ok: true });
              const slmResult = await inferRequirementsWithSLM(scanDir);
              if (slmResult) {
                await Bun.write(generatedReqPath, slmResult.packages.join("\n") + "\n");
                steps.push({ label: `SLM inferred ${slmResult.packages.length} package${slmResult.packages.length === 1 ? "" : "s"} via ${slmResult.model} (${slmResult.lane})`, ok: true });
                const slmStep = await runFix([pipBin, "install", "-r", generatedReqPath], engineCwd, `${pipLabel} (slm)`);
                steps.push(slmStep);
              } else {
                steps.push({ label: "No local model available for inference — manual requirements.txt needed", ok: false });
              }
            }
          } else {
            steps.push(pipStep);
          }
        } else {
          steps.push(pipStep);
        }
      }
    }

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
