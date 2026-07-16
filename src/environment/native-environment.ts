import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { userConfigDir } from "../config/paths";

const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const EXCLUDED_DIRECTORIES = new Set([".git", ".switchbay", "node_modules", ".next", ".cache", "coverage", "dist", "build"]);
const EXCLUDED_FILE_NAMES = new Set([".npmrc", ".pypirc", "credentials.json", "secrets.json", "token.json"]);
const EXCLUDED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

export type NativeEnvironmentHandle = {
  id: string;
  root: string;
  workspace: string;
  home: string;
  tmp: string;
  sourceCwd: string;
  backend: "macos-seatbelt";
  snapshotFiles: number;
  snapshotBytes: number;
};

export type NativeEnvironmentResult = {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

export function nativeEnvironmentAvailability(): { available: boolean; backend: string; reason?: string } {
  if (process.platform !== "darwin") {
    return { available: false, backend: "unavailable", reason: "Strict native execution currently requires macOS Seatbelt." };
  }
  if (!existsSync("/usr/bin/sandbox-exec")) {
    return { available: false, backend: "unavailable", reason: "macOS sandbox-exec is unavailable." };
  }
  return { available: true, backend: "macos-seatbelt" };
}

export function nativeEnvironmentRoot(): string {
  return join(userConfigDir(), "runtime", "environments");
}

export async function ensureNativeEnvironment(sessionId: string, sourceCwd: string, baseRoot = nativeEnvironmentRoot()): Promise<NativeEnvironmentHandle> {
  const availability = nativeEnvironmentAvailability();
  if (!availability.available) throw new Error(availability.reason ?? "Native environment is unavailable.");
  const id = sanitizeId(sessionId || "one-shot");
  const requestedRoot = join(baseRoot, id);
  const requestedWorkspace = join(requestedRoot, "workspace");
  const requestedHome = join(requestedRoot, "home");
  const requestedTmp = join(requestedRoot, "tmp");
  const requestedManifestPath = join(requestedRoot, "environment.json");
  const normalizedSource = resolve(sourceCwd);

  try {
    const existing = JSON.parse(await readFile(requestedManifestPath, "utf8")) as NativeEnvironmentHandle;
    if (existing.sourceCwd === normalizedSource && existsSync(existing.workspace)) return existing;
  } catch { /* create a new environment */ }

  await rm(requestedRoot, { recursive: true, force: true });
  await Promise.all([mkdir(requestedWorkspace, { recursive: true, mode: 0o700 }), mkdir(requestedHome, { recursive: true, mode: 0o700 }), mkdir(requestedTmp, { recursive: true, mode: 0o700 })]);
  const root = await realpath(requestedRoot);
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const manifestPath = join(root, "environment.json");
  const copied = { files: 0, bytes: 0 };
  await snapshotDirectory(normalizedSource, workspace, copied);
  const handle: NativeEnvironmentHandle = {
    id,
    root,
    workspace,
    home,
    tmp,
    sourceCwd: normalizedSource,
    backend: "macos-seatbelt",
    snapshotFiles: copied.files,
    snapshotBytes: copied.bytes,
  };
  await writeFile(manifestPath, JSON.stringify(handle, null, 2), { encoding: "utf8", mode: 0o600 });
  return handle;
}

export async function resetNativeEnvironment(sessionId?: string, root = nativeEnvironmentRoot()): Promise<void> {
  if (sessionId) await rm(join(root, sanitizeId(sessionId)), { recursive: true, force: true });
  else await rm(root, { recursive: true, force: true });
}

export function resolveNativeEnvironmentPath(handle: NativeEnvironmentHandle, input: string): string {
  const requested = String(input || "").trim();
  if (!requested) throw new Error("Native environment path is required.");
  let candidate: string;
  if (isAbsolute(requested)) {
    if (requested === handle.sourceCwd || requested.startsWith(`${handle.sourceCwd}${sep}`)) {
      candidate = join(handle.workspace, relative(handle.sourceCwd, requested));
    } else if (requested === handle.workspace || requested.startsWith(`${handle.workspace}${sep}`)) {
      candidate = requested;
    } else {
      throw new Error("Native environment paths must remain inside the isolated workspace.");
    }
  } else {
    candidate = resolve(handle.workspace, requested);
  }
  const rel = relative(handle.workspace, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Native environment path escapes the isolated workspace.");
  }
  return candidate;
}

export async function runInNativeEnvironment(
  handle: NativeEnvironmentHandle,
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<NativeEnvironmentResult> {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) throw new Error("Native Bash requires a command.");
  const rewrittenCommand = normalizedCommand.split(handle.sourceCwd).join(handle.workspace);
  const timeoutMs = Math.max(100, Math.min(120_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxOutputBytes = Math.max(1024, Math.min(1024 * 1024, options.maxOutputBytes ?? MAX_OUTPUT_BYTES));
  const profile = seatbeltProfile(handle);
  const bunDir = dirname(Bun.which("bun") ?? "/usr/bin/false");
  const proc = Bun.spawn({
    cmd: ["/usr/bin/sandbox-exec", "-p", profile, "/bin/bash", "-lc", rewrittenCommand],
    cwd: handle.workspace,
    env: {
      HOME: handle.home,
      TMPDIR: handle.tmp,
      PATH: `${bunDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      TERM: "dumb",
      SWITCHBAY_NATIVE_ENV: "1",
      SWITCHBAY_NATIVE_WORKSPACE: handle.workspace,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let truncated = false;
  const stop = () => { try { proc.kill("SIGKILL"); } catch {} };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    readCapped(proc.stdout, maxOutputBytes, () => { truncated = true; stop(); }),
    readCapped(proc.stderr, maxOutputBytes, () => { truncated = true; stop(); }),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  return {
    ok: exitCode === 0 && !timedOut && !truncated,
    command: rewrittenCommand,
    cwd: handle.workspace,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    timedOut,
    truncated,
  };
}

export async function executeNativeEditor(
  handle: NativeEnvironmentHandle,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; summary: string; body: string; changedFile?: string }> {
  const command = String(args.command || "").trim();
  const target = resolveNativeEnvironmentPath(handle, String(args.path || ""));
  await assertNoSymlinkTraversal(handle.workspace, target);
  const relativePath = relative(handle.workspace, target);
  if (command === "view") {
    const content = await readFile(target, "utf8");
    const range = Array.isArray(args.view_range) ? args.view_range.map(Number) : [];
    const lines = content.split("\n");
    const start = Math.max(1, Number.isFinite(range[0]) ? range[0]! : 1);
    const end = Math.min(lines.length, Number.isFinite(range[1]) && range[1]! > 0 ? range[1]! : lines.length);
    return { ok: true, summary: `Viewed ${relativePath}`, body: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n") };
  }
  if (command === "create") {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, String(args.file_text ?? ""), "utf8");
    return { ok: true, summary: `Created ${relativePath} in native environment`, body: `Created ${relativePath} in the isolated environment.`, changedFile: `native:${relativePath}` };
  }
  if (command === "str_replace") {
    const before = await readFile(target, "utf8");
    const oldText = String(args.old_str ?? "");
    const matches = oldText ? before.split(oldText).length - 1 : 0;
    if (matches !== 1) throw new Error(`str_replace requires exactly one match; found ${matches}.`);
    await writeFile(target, before.replace(oldText, String(args.new_str ?? "")), "utf8");
    return { ok: true, summary: `Edited ${relativePath} in native environment`, body: `Replaced one block in ${relativePath}.`, changedFile: `native:${relativePath}` };
  }
  if (command === "insert") {
    const before = await readFile(target, "utf8");
    const lines = before.split("\n");
    const insertLine = Number(args.insert_line);
    if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) throw new Error("insert_line must be between 0 and the file line count.");
    lines.splice(insertLine, 0, String(args.new_str ?? ""));
    await writeFile(target, lines.join("\n"), "utf8");
    return { ok: true, summary: `Inserted into ${relativePath} in native environment`, body: `Inserted content after line ${insertLine} in ${relativePath}.`, changedFile: `native:${relativePath}` };
  }
  throw new Error(`Unsupported native editor command: ${command || "missing"}.`);
}

export async function publishNativeEnvironmentFiles(
  handle: NativeEnvironmentHandle,
  paths: string[],
): Promise<{ published: string[]; skipped: string[] }> {
  const published: string[] = [];
  const skipped: string[] = [];
  for (const requested of paths) {
    const source = resolveNativeEnvironmentPath(handle, requested);
    const rel = relative(handle.workspace, source);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) {
      skipped.push(`${requested}: not a file`);
      continue;
    }
    const target = resolve(handle.sourceCwd, rel);
    const targetRel = relative(handle.sourceCwd, target);
    if (targetRel === ".." || targetRel.startsWith(`..${sep}`) || isAbsolute(targetRel)) {
      skipped.push(`${requested}: outside source workspace`);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    published.push(rel);
  }
  return { published, skipped };
}

async function assertNoSymlinkTraversal(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Native editor refuses symlink paths.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function describeNativeEnvironment(sessionId?: string, cwd = process.cwd()): Promise<string> {
  const availability = nativeEnvironmentAvailability();
  const lines = ["**Switchbay Native Environment**", "", `Backend: **${availability.backend}**`, `Available: **${availability.available ? "yes" : "no"}**`, "Policy: isolated · no network · scrubbed environment · bounded execution"];
  if (availability.reason) lines.push(`Reason: ${availability.reason}`);
  if (sessionId && availability.available) {
    try {
      const handle = await ensureNativeEnvironment(sessionId, cwd);
      lines.push(`Environment: \`${handle.id}\``, `Snapshot: ${handle.snapshotFiles} files · ${formatBytes(handle.snapshotBytes)}`, `Workspace: \`${handle.workspace}\``);
    } catch { /* status remains useful without creating */ }
  }
  return lines.join("\n");
}

function seatbeltProfile(handle: NativeEnvironmentHandle): string {
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    `(deny file-read* (subpath ${seatbeltString(homedir())}))`,
    `(allow file-read* (subpath ${seatbeltString(handle.root)}))`,
    `(allow file-write* (subpath ${seatbeltString(handle.root)}))`,
    `(allow file-write-data (literal "/dev/null"))`,
    "(deny network*)",
  ].join("\n");
}

function seatbeltString(value: string): string {
  return JSON.stringify(value);
}

async function snapshotDirectory(source: string, destination: string, copied: { files: number; bytes: number }): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry.name) || shouldExcludeFile(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 });
      await snapshotDirectory(from, to, copied);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(from);
    if (info.size > MAX_SNAPSHOT_FILE_BYTES || copied.bytes + info.size > MAX_SNAPSHOT_BYTES) continue;
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await copyFile(from, to);
    copied.files += 1;
    copied.bytes += info.size;
  }
}

function shouldExcludeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.") || EXCLUDED_FILE_NAMES.has(lower) || EXCLUDED_EXTENSIONS.has(extname(lower));
}

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, onCap: () => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      const remaining = Math.max(0, cap - (bytes - value.byteLength));
      if (remaining) output += decoder.decode(value.slice(0, remaining), { stream: true });
      output += "\n… [output truncated]";
      onCap();
      break;
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96) || "one-shot";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
