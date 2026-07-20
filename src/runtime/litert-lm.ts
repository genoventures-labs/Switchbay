import { startDaemon, stopDaemon, daemonStatus, daemonLogs } from "./service-daemon";
import { runCommand } from "../tools/shell";

export const LITERT_PORT = 9379;
export const LITERT_BASE_URL = `http://localhost:${LITERT_PORT}/v1`;
export const LITERT_HEALTH_URL = `${LITERT_BASE_URL}/models`;
export const LITERT_DAEMON_NAME = "litert-lm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

export type ServeOptions = {
  host?: string;
  port?: number;
  backend?: "cpu" | "gpu";
};

export async function startLiteRtServer(opts: ServeOptions = {}): Promise<{ pid: number; alreadyRunning: boolean; logPath: string }> {
  const port = opts.port ?? LITERT_PORT;
  const args = ["serve", "--port", String(port)];
  if (opts.host) args.push("--host", opts.host);
  if (opts.backend) args.push("--backend", opts.backend);

  return startDaemon(LITERT_DAEMON_NAME, "litert-lm", args, {
    healthUrl: `http://localhost:${port}/v1/models`,
    timeoutMs: 15_000,
  });
}

export async function stopLiteRtServer() {
  return stopDaemon(LITERT_DAEMON_NAME);
}

export async function liteRtStatus() {
  return daemonStatus(LITERT_DAEMON_NAME);
}

export async function liteRtLogs(tail = 40) {
  return daemonLogs(LITERT_DAEMON_NAME, tail);
}

// ── Model management ──────────────────────────────────────────────────────────

export type LiteRtModel = {
  id: string;
  object: string;
  created?: number;
};

export async function liteRtServerModels(): Promise<LiteRtModel[]> {
  try {
    const res = await fetch(LITERT_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { data?: LiteRtModel[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

export async function liteRtImport(hfRepo: string, filename: string, localId: string): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand(["litert-lm", "import", "--from-huggingface-repo", hfRepo, filename, localId], process.cwd());
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
}

export async function liteRtLocalList(): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand(["litert-lm", "list"], process.cwd());
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
}

export async function liteRtDelete(localId: string): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand(["litert-lm", "delete", localId], process.cwd());
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
}

// ── Completions (OpenAI-compat) ───────────────────────────────────────────────

export type LiteRtMessage = { role: string; content: string };

export async function liteRtChat(model: string, messages: LiteRtMessage[], stream = false): Promise<Response> {
  return fetch(`${LITERT_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function isLiteRtAvailable(): Promise<boolean> {
  const which = Bun.which("litert-lm");
  return which !== null;
}

export async function isLiteRtServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(LITERT_HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Known models from litert-community HF org — used for `litert models` suggestions
export const KNOWN_LITERT_MODELS: Array<{ id: string; hfRepo: string; filename: string; size: string; description: string }> = [
  {
    id: "gemma4-e2b",
    hfRepo: "litert-community/gemma-4-E2B-it-litert-lm",
    filename: "gemma-4-E2B-it.litertlm",
    size: "2.58 GB",
    description: "Gemma 4 2B instruction-tuned — fast, good for general use",
  },
  {
    id: "gemma4-e4b",
    hfRepo: "litert-community/gemma-4-E4B-it-litert-lm",
    filename: "gemma-4-E4B-it.litertlm",
    size: "3.65 GB",
    description: "Gemma 4 4B instruction-tuned — stronger reasoning",
  },
  {
    id: "phi4-mini",
    hfRepo: "litert-community/phi-4-mini-instruct-litert-lm",
    filename: "phi-4-mini-instruct.litertlm",
    size: "~2 GB",
    description: "Microsoft Phi-4-mini — code and reasoning focused",
  },
  {
    id: "qwen2.5-0.5b",
    hfRepo: "litert-community/Qwen2.5-0.5B-Instruct-litert-lm",
    filename: "Qwen2.5-0.5B-Instruct.litertlm",
    size: "521 MB",
    description: "Qwen 2.5 0.5B — smallest, fastest, fits anywhere",
  },
  {
    id: "qwen2.5-1.5b",
    hfRepo: "litert-community/Qwen2.5-1.5B-Instruct-litert-lm",
    filename: "Qwen2.5-1.5B-Instruct.litertlm",
    size: "~1 GB",
    description: "Qwen 2.5 1.5B — good balance of size and quality",
  },
];
