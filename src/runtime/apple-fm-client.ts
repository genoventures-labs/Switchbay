import { resolve } from "node:path";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";
import type { ChatRuntimeClient } from "./client";

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
};

export class AppleFmClient implements ChatRuntimeClient {
  private readonly model?: string;

  constructor(options: AppleFmOptions = {}) {
    this.model = options.model?.trim() || undefined;
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

    const payload = {
      system,
      messages: conversation.map(m => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content),
      })),
      model: this.model,
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
          model: "apple-fm",
          using: "local/apple-fm/unavailable",
          done_reason: "error",
        },
      };
    }

    const modelId = this.model ?? "default";
    return {
      choices: [{
        message: { role: "assistant", content: fullText },
        finish_reason: "stop",
      }],
      meta: {
        provider: "apple-fm",
        model: `apple-fm/${modelId}`,
        using: `local/apple-fm/${modelId}`,
        done_reason: "stop",
      },
    };
  }
}
