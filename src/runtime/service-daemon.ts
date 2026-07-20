import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const DAEMON_DIR = path.join(os.homedir(), ".switchbay", "daemons");

export type DaemonInfo = {
  name: string;
  pid: number;
  startedAt: string;
  cmd: string;
  logPath: string;
};

export type StartDaemonOptions = {
  /** Env vars to merge into the child's environment */
  env?: Record<string, string>;
  /** Directory to run the process in */
  cwd?: string;
  /** Poll this URL for readiness (GET must return 2xx within timeoutMs) */
  healthUrl?: string;
  /** Max ms to wait for healthUrl to respond */
  timeoutMs?: number;
};

function pidPath(name: string): string {
  return path.join(DAEMON_DIR, `${name}.pid`);
}

function logPath(name: string): string {
  return path.join(DAEMON_DIR, `${name}.log`);
}

export async function startDaemon(
  name: string,
  cmd: string,
  args: string[],
  opts: StartDaemonOptions = {},
): Promise<{ pid: number; alreadyRunning: boolean; logPath: string }> {
  await fs.mkdir(DAEMON_DIR, { recursive: true });

  // If already alive, return early
  const existing = await readDaemonInfo(name);
  if (existing && (await isProcessAlive(existing.pid))) {
    return { pid: existing.pid, alreadyRunning: true, logPath: existing.logPath };
  }

  const log = logPath(name);

  // Rotate log (keep last 512 KB)
  try {
    const stat = await fs.stat(log);
    if (stat.size > 512 * 1024) await fs.truncate(log, 0);
  } catch { /* no existing log */ }

  // Open log file for appending — pass the fd so both stdout and stderr go there
  const logFd = await fs.open(log, "a");

  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", logFd.fd, logFd.fd],
    detached: true,
  });

  await logFd.close();

  proc.unref();

  const info: DaemonInfo = {
    name,
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    cmd: [cmd, ...args].join(" "),
    logPath: log,
  };
  await fs.writeFile(pidPath(name), JSON.stringify(info, null, 2), "utf-8");

  // Poll health endpoint until ready or timeout
  if (opts.healthUrl) {
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    while (Date.now() < deadline) {
      await sleep(300);
      try {
        const res = await fetch(opts.healthUrl, { signal: AbortSignal.timeout(800) });
        if (res.ok) break;
      } catch { /* not ready yet */ }
    }
  }

  return { pid: proc.pid, alreadyRunning: false, logPath: log };
}

export async function stopDaemon(name: string): Promise<{ stopped: boolean; pid?: number }> {
  const info = await readDaemonInfo(name);
  if (!info) return { stopped: false };

  const alive = await isProcessAlive(info.pid);
  if (!alive) {
    await fs.rm(pidPath(name), { force: true });
    return { stopped: false, pid: info.pid };
  }

  try {
    process.kill(info.pid, "SIGTERM");
    // Give it 2s to exit gracefully, then SIGKILL
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && (await isProcessAlive(info.pid))) {
      await sleep(200);
    }
    if (await isProcessAlive(info.pid)) process.kill(info.pid, "SIGKILL");
  } catch { /* already gone */ }

  await fs.rm(pidPath(name), { force: true });
  return { stopped: true, pid: info.pid };
}

export async function daemonStatus(name: string): Promise<{ running: boolean; info?: DaemonInfo }> {
  const info = await readDaemonInfo(name);
  if (!info) return { running: false };
  const running = await isProcessAlive(info.pid);
  if (!running) await fs.rm(pidPath(name), { force: true });
  return { running, info: running ? info : undefined };
}

export async function daemonLogs(name: string, tail = 40): Promise<string> {
  const log = logPath(name);
  if (!existsSync(log)) return "(no log file)";
  const content = await fs.readFile(log, "utf-8");
  const lines = content.trimEnd().split("\n");
  return lines.slice(-tail).join("\n");
}

async function readDaemonInfo(name: string): Promise<DaemonInfo | null> {
  const p = pidPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as DaemonInfo;
  } catch {
    return null;
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
