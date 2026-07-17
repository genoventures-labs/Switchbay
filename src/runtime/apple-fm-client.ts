import { resolve } from "node:path";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";
import type { ChatRuntimeClient } from "./client";

// ── Apple FM variant routing ───────────────────────────────────────────────────

export type AppleVariant = "core" | "core-advanced" | "cloud" | "cloud-pro";

// Signals that a task involves sustained reasoning or deep analysis — score +3
const DEEP_PATTERNS = /\b(step[- ]by[- ]step|reason\s+through|walk\s+me\s+through|prove|proof\s+of|theorem|derive|mathematical\s+proof|multi[- ]?step\s+reasoning|think\s+through|think\s+carefully|comprehensive\s+analysis|in[\s-]depth\s+analysis|deeply\s+analyze|critically\s+evaluate)\b/i;
// Signals that a task involves code or moderate complexity — score +2
const CODE_PATTERNS = /\b(implement|refactor|debug|write\s+(a\s+)?(function|class|module|script|program|test)|create\s+(a\s+)?(function|class|component|service|api)|build\s+(a\s+)?|review\s+code|explain\s+in\s+detail|analyze|analyse|synthesize|compare\s+(and\s+contrast)?|audit|migrate|architect|design\s+(a\s+)?(system|pattern|schema|api)|comprehensive)\b/i;
const SIMPLE_PATTERNS = /^(hi|hello|hey|thanks|thank\s+you|ok|okay|yes|no|sure|got\s+it|sounds\s+good|what('s| is) (the |your )?name|who\s+are\s+you)[?!.,\s]*$/i;

function hasImageContent(messages: ChatCompletionRequest["messages"]): boolean {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type?: string }>) {
        if (part?.type === "image_url" || part?.type === "image") return true;
      }
    }
  }
  return false;
}

function totalContentLength(messages: ChatCompletionRequest["messages"]): number {
  return messages.reduce((sum, msg) => {
    if (typeof msg.content === "string") return sum + msg.content.length;
    if (Array.isArray(msg.content)) {
      return sum + (msg.content as Array<{ text?: string }>).reduce((s, p) => s + (p?.text?.length ?? 0), 0);
    }
    return sum;
  }, 0);
}

function latestUserMessage(messages: ChatCompletionRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      const c = messages[i]!.content;
      return typeof c === "string" ? c : "";
    }
  }
  return "";
}

/**
 * Route an AFM request to the appropriate model variant.
 * Returns "default" when a model has already been explicitly chosen.
 *
 * Scoring:
 *   0       → core        (fast on-device, simple tasks)
 *   1–2     → core-advanced (heavier on-device, code, moderate length)
 *   3–4     → cloud       (PCC fast, task too heavy for on-device)
 *   5+      → cloud-pro   (PCC reasoning, complex multi-step)
 */
export function routeAppleModel(request: ChatCompletionRequest): AppleVariant {
  let score = 0;

  const latest = latestUserMessage(request.messages);
  if (SIMPLE_PATTERNS.test(latest.trim())) return "core";
  // Explicit reasoning/proof signals are unambiguous — go straight to cloud-pro
  if (DEEP_PATTERNS.test(latest)) return "cloud-pro";

  const totalChars = totalContentLength(request.messages);
  const historyTurns = request.messages.filter(m => m.role !== "system").length;
  const toolCount = request.tools?.length ?? 0;

  // Length signals
  if (totalChars > 800)  score += 1;
  if (totalChars > 3000) score += 1;
  if (totalChars > 8000) score += 2;

  // Multimodal
  if (hasImageContent(request.messages)) score += 2;

  // History depth (long conversation = sustained complexity)
  if (historyTurns > 6)  score += 2;
  if (historyTurns > 14) score += 1;

  // Tool richness (many tools = complex agentic context)
  if (toolCount > 4)  score += 2;
  if (toolCount > 10) score += 1;

  // Code / moderate complexity
  if (CODE_PATTERNS.test(latest)) score += 2;

  if (score >= 5) return "cloud-pro";
  if (score >= 3) return "cloud";
  if (score >= 1) return "core-advanced";
  return "core";
}

const BRIDGE_SCRIPT = resolve(
  Bun.env.HOME ?? process.env.HOME ?? "~",
  ".switchbay/engine-bay/Switchbay-Engines/engines/Python/AppleFM/apple_fm_bridge.py",
);

type BridgeEvent =
  | { type: "token"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  | { type: "unavailable"; message: string };

type AppleFmOptions = {
  model?: string;
  /** Restrict inference to on-device models only. */
  localMode?: "off" | "local" | "offline";
  /**
   * Called when auto-routing would escalate to a cloud AFM variant but
   * localMode is active. Return true to allow the escalation, false to
   * stay on the best available local model (core-advanced).
   */
  onEscalationConfirm?: (targetVariant: AppleVariant) => Promise<boolean>;
};

export class AppleFmClient implements ChatRuntimeClient {
  private readonly model?: string;
  private readonly localMode: "off" | "local" | "offline";
  private readonly onEscalationConfirm?: (targetVariant: AppleVariant) => Promise<boolean>;

  constructor(options: AppleFmOptions = {}) {
    this.model = options.model?.trim() || undefined;
    this.localMode = options.localMode ?? "off";
    this.onEscalationConfirm = options.onEscalationConfirm;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: {
      onToken?: (token: string) => void;
    } = {},
  ): Promise<ChatCompletionResponse> {
    // Extract system prompt
    const systemMsg = request.messages.find(m => m.role === "system");
    const baseSystem = typeof systemMsg?.content === "string" ? systemMsg.content : "";

    // Inject tool descriptions into the system prompt so the on-device model
    // can emit <tool_call>{"name":...,"args":...}</tool_call> for parseInlineToolCalls in loop.ts
    let system = baseSystem;
    if (request.tools && request.tools.length > 0) {
      const toolDocs = request.tools.map(t => {
        const fn = t.function;
        const schema = fn.parameters ? JSON.stringify(fn.parameters) : "{}";
        return `- **${fn.name}**: ${fn.description ?? "no description"}\n  Parameters: ${schema}`;
      }).join("\n");
      system +=
        `\n\n## Tools\n\nYou have access to the following tools. ` +
        `When you need to call one, output it as:\n` +
        `<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>\n\n` +
        `Available tools:\n${toolDocs}`;
    }

    const conversation = request.messages.filter(m => m.role !== "system");

    const isAuto = !this.model || this.model === "auto" || this.model === "default";
    let resolvedModel: string = isAuto ? routeAppleModel(request) : this.model!;

    // Enforce local-mode: cloud variants require explicit user confirmation
    const isLocalMode = this.localMode === "local" || this.localMode === "offline";
    const wouldEscalate = isLocalMode && (resolvedModel === "cloud" || resolvedModel === "cloud-pro");
    if (wouldEscalate) {
      const targetVariant = resolvedModel as AppleVariant;
      const allowed = this.onEscalationConfirm
        ? await this.onEscalationConfirm(targetVariant)
        : false;
      if (!allowed) resolvedModel = "core-advanced";
    }

    const payload = {
      system,
      messages: conversation.map(m => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content),
      })),
      model: resolvedModel,
    };

    let fullText = "";
    let errorMsg: string | null = null;
    let unavailable = false;

    try {
      const python = Bun.env.SWITCHBAY_PYTHON
        ?? Bun.env.PYTHON3_PATH
        ?? "/opt/homebrew/bin/python3";
      const proc = Bun.spawn([python, BRIDGE_SCRIPT], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdin = proc.stdin as import("bun").FileSink;
      stdin.write(JSON.stringify(payload) + "\n");
      stdin.end();

      const stdout = proc.stdout as ReadableStream<Uint8Array>;
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as BridgeEvent;
            if (event.type === "token") {
              fullText += event.text;
              options.onToken?.(event.text);
            } else if (event.type === "done") {
              fullText = event.text;
            } else if (event.type === "error") {
              errorMsg = event.message;
            } else if (event.type === "unavailable") {
              unavailable = true;
              errorMsg = event.message;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      await proc.exited;
    } catch (spawnError) {
      errorMsg = `Failed to launch Apple FM bridge: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}. Is python3 on PATH?`;
    }

    if (unavailable || (errorMsg && !fullText)) {
      const msg = errorMsg ?? "Apple Foundation Models unavailable";
      const content = unavailable
        ? `> **Apple Intelligence not available**\n> ${msg}`
        : `> **Apple FM error:** ${msg}`;
      return {
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        meta: {
          provider: "apple-fm",
          model: `apple-fm/${resolvedModel}`,
          using: `local/apple-fm/${resolvedModel}/unavailable`,
          done_reason: "error",
        },
      };
    }

    return {
      choices: [{
        message: { role: "assistant", content: fullText },
        finish_reason: "stop",
      }],
      meta: {
        provider: "apple-fm",
        model: `apple-fm/${resolvedModel}`,
        using: `local/apple-fm/${resolvedModel}${isAuto ? "/auto" : ""}`,
        done_reason: "stop",
      },
    };
  }
}
