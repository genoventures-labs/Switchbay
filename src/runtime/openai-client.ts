import {
  getDebugEmptyResponses,
  getOpenAiApiKey,
  getOpenAiBase,
  getOpenAiModel,
} from "../config/env";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";

type OpenAiClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export class OpenAiClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiClientOptions = {}) {
    this.apiBase = options.apiBase ?? getOpenAiBase();
    this.apiKey = options.apiKey ?? getOpenAiApiKey();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: { onToken?: (token: string) => void } = {},
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error("Missing OPENAI_API_KEY");
    }

    const useStream = typeof options.onToken === "function";
    const response = await this.fetchImpl(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? getOpenAiModel(),
        messages: request.messages,
        stream: useStream,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.tool_choice !== undefined ? { tool_choice: request.tool_choice } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }

    if (!useStream) {
      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as ChatCompletionResponse;
      parsed._rawText = rawText;

      if (getDebugEmptyResponses()) {
        const content = parsed.choices?.[0]?.message?.content;
        if ((typeof content !== "string" || content.trim().length === 0) && !parsed.choices?.[0]?.message?.tool_calls?.length) {
          console.error("[code-harness] empty-looking OpenAI response:");
          console.error(rawText);
        }
      }

      return parsed;
    }

    return readOpenAiStream(response, options.onToken!);
  }
}

async function readOpenAiStream(response: Response, onToken: (token: string) => void): Promise<ChatCompletionResponse> {
  let accText = "";
  const toolCallMap: Record<number, { id: string; name: string; arguments: string }> = {};
  let hasToolCalls = false;

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") break outer;

      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        accText += delta.content;
        onToken(delta.content);
      }

      if (delta.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          if (!toolCallMap[tc.index]) {
            toolCallMap[tc.index] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          const toolCall = toolCallMap[tc.index]!;
          if (tc.id) toolCall.id = tc.id;
          if (tc.function?.name) toolCall.name += tc.function.name;
          if (tc.function?.arguments) toolCall.arguments += tc.function.arguments;
        }
      }
    }
  }

  const toolCalls = hasToolCalls
    ? Object.entries(toolCallMap).map(([, tc]) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }))
    : undefined;

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: accText || null,
          tool_calls: toolCalls,
        },
        finish_reason: hasToolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}
