import { hasCloudProviderKey, getCloudProviderConfig, getCloudProviderApiKey } from "../runtime/cloud-providers";
import { startDaemon, stopDaemon, daemonStatus, daemonLogs } from "../runtime/service-daemon";

export const EXTENSION_PORT = 7842;
export const EXTENSION_DAEMON_NAME = "switchbay-extension";

// ── Daemon lifecycle (background mode) ───────────────────────────────────────

export async function startExtensionDaemon(): Promise<{ pid: number; alreadyRunning: boolean; logPath: string }> {
  return startDaemon(
    EXTENSION_DAEMON_NAME,
    process.execPath,
    [Bun.main, "--extension-serve-fg"],
    {
      healthUrl: `http://localhost:${EXTENSION_PORT}/health`,
      timeoutMs: 8_000,
    },
  );
}

export async function stopExtensionDaemon() {
  return stopDaemon(EXTENSION_DAEMON_NAME);
}

export async function extensionDaemonStatus() {
  return daemonStatus(EXTENSION_DAEMON_NAME);
}

export async function extensionDaemonLogs(tail = 40) {
  return daemonLogs(EXTENSION_DAEMON_NAME, tail);
}

// ── Foreground server (called by the daemon child process) ───────────────────

const SYSTEM_PROMPT = `You are a helpful assistant embedded in a browser extension powered by Switchbay. You analyze web page content and answer questions about it. Be concise, clear, and accurate. Use markdown formatting — bullet points and bold — where it helps readability. Never make up information that isn't present in the provided content.`;

type AskBody = {
  content?: string;
  selection?: string;
  question?: string;
  url?: string;
  title?: string;
  action?: "summarize" | "keypoints" | "simplify" | "ask";
};

const ALLOWED_ORIGIN = /^chrome-extension:\/\//;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN.test(origin) || origin === "null";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function buildUserMessage(body: AskBody): string {
  const { content, selection, question, url, title, action } = body;
  const pageRef = title ? `"${title}"` : url ?? "this page";

  if (selection) {
    const q = question || (action === "simplify" ? "Explain this in plain language." : "Summarize this selection.");
    return `Selected text from ${pageRef}:\n\n${selection}\n\n${q}`;
  }

  const pageContent = (content ?? "").slice(0, 10000);
  const contextLine = `Web page: ${pageRef}${url ? ` (${url})` : ""}\n\nPage content:\n${pageContent}`;

  if (action === "summarize" && !question) return `${contextLine}\n\nSummarize this page in 4–6 concise bullet points.`;
  if (action === "keypoints" && !question) return `${contextLine}\n\nWhat are the most important takeaways or key facts from this page? List them as bullet points.`;
  if (action === "simplify" && !question) return `${contextLine}\n\nRewrite the main content of this page in plain, simple language someone could understand quickly.`;
  return `${contextLine}\n\n${question || "Summarize this page."}`;
}

async function callAI(userMessage: string): Promise<string> {
  const providers = ["openai", "anthropic", "google"] as const;
  const provider = providers.find((p) => hasCloudProviderKey(p));
  if (!provider) throw new Error("No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.");

  const cfg = getCloudProviderConfig(provider);
  const apiKey = getCloudProviderApiKey(provider)!;

  console.log(`[extension] calling ${provider} model=${cfg.model}`);

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMessage }],
        max_completion_tokens: 1024,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    console.log(`[extension] openai status=${res.status}`, JSON.stringify(data).slice(0, 200));
    if (!res.ok) throw new Error((data.error as { message?: string })?.message ?? `OpenAI error ${res.status}`);
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    const text = choices?.[0]?.message?.content;
    if (!text) throw new Error(`Unexpected OpenAI response: ${JSON.stringify(data).slice(0, 200)}`);
    return text;
  }

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: cfg.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: 1024,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    console.log(`[extension] anthropic status=${res.status}`, JSON.stringify(data).slice(0, 200));
    if (!res.ok) throw new Error((data.error as { message?: string })?.message ?? `Anthropic error ${res.status}`);
    const content = data.content as Array<{ type: string; text: string }> | undefined;
    const text = content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error(`Unexpected Anthropic response: ${JSON.stringify(data).slice(0, 200)}`);
    return text;
  }

  if (provider === "google") {
    const model = cfg.model ?? "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    console.log(`[extension] google status=${res.status}`, JSON.stringify(data).slice(0, 200));
    if (!res.ok) throw new Error((data.error as { message?: string })?.message ?? `Google error ${res.status}`);
    const candidates = data.candidates as Array<{ content: { parts: Array<{ text: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Unexpected Google response: ${JSON.stringify(data).slice(0, 200)}`);
    return text;
  }

  throw new Error("Unsupported provider.");
}

export function startExtensionServer() {
  Bun.serve({
    port: EXTENSION_PORT,
    async fetch(req) {
      const cors = corsHeaders(req);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return Response.json({ ok: true, port: EXTENSION_PORT }, { headers: cors });
      }

      if (url.pathname === "/ask" && req.method === "POST") {
        try {
          const body = await req.json() as AskBody;
          const response = await callAI(buildUserMessage(body));
          return Response.json({ response }, { headers: cors });
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: cors });
        }
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  });

  console.log(`[switchbay-extension] server on http://localhost:${EXTENSION_PORT}`);
}
