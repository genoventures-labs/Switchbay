import { getDebugEmptyResponses } from "../config/env";
import { getLocalProviderConfig } from "./local-providers";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";
import { readConfiguredSecret } from "../config/secrets";

type OllamaClientOptions = {
  apiBase?: string;
  model?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  provider?: "ollama" | "ollama-cloud";
};

type OllamaChatResponse = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }>;
  };
  done?: boolean;
  done_reason?: string;
};

export class OllamaClient {
  private readonly apiBase: string;
  private readonly model?: string;
  private readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly provider: "ollama" | "ollama-cloud";

  constructor(options: OllamaClientOptions = {}) {
    this.provider = options.provider ?? "ollama";
    const config = getLocalProviderConfig(this.provider);
    this.apiBase = options.apiBase ?? config.apiBase;
    this.model = options.model ?? config.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: {
      onToken?: (token: string) => void;
    } = {},
  ): Promise<ChatCompletionResponse> {
    const useStream = typeof options.onToken === "function";
    const response = await this.fetchImpl(`${this.apiBase}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.provider === "ollama-cloud" ? { Authorization: `Bearer ${readConfiguredSecret("OLLAMA_API_KEY") ?? ""}` } : {}),
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages.map((msg) => {
          if (!msg.tool_calls || !msg.tool_calls.length) return msg;
          return {
            ...msg,
            tool_calls: msg.tool_calls.map((tc) => {
              if (typeof tc.function?.arguments === "string") {
                try {
                  return {
                    ...tc,
                    function: {
                      ...tc.function,
                      arguments: JSON.parse(tc.function.arguments),
                    },
                  };
                } catch {
                  // Keep as-is if parsing fails
                }
              }
              return tc;
            }),
          };
        }),
        stream: useStream,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${this.provider === "ollama-cloud" ? "Ollama Cloud" : "Ollama"} API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }

    if (!useStream) {
      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as OllamaChatResponse;
      const normalized = normalizeOllamaResponse(parsed, this.provider);
      normalized._rawText = rawText;
      if (getDebugEmptyResponses() && !normalized.choices?.[0]?.message?.content) {
        console.error("[switchbay] empty-looking Ollama response:");
        console.error(rawText);
      }
      return normalized;
    }

    return streamOllamaResponse(response, options.onToken!, this.provider);
  }
}

function normalizeOllamaResponse(parsed: OllamaChatResponse, provider: "ollama" | "ollama-cloud"): ChatCompletionResponse {
  const toolCalls = parsed.message?.tool_calls?.map((toolCall, index) => ({
    id: `ollama_tool_${index}`,
    type: "function" as const,
    function: {
      name: toolCall.function?.name ?? "",
      arguments: JSON.stringify(toolCall.function?.arguments ?? {}),
    },
  })).filter((toolCall) => toolCall.function.name);

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: parsed.message?.content ?? "",
          tool_calls: toolCalls && toolCalls.length ? toolCalls : undefined,
        },
        finish_reason: toolCalls && toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    meta: {
      provider,
      model: parsed.model,
      done_reason: parsed.done_reason,
    },
  };
}

async function streamOllamaResponse(response: Response, onToken: (token: string) => void, provider: "ollama" | "ollama-cloud"): Promise<ChatCompletionResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accText = "";
  let last: OllamaChatResponse = {};
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: OllamaChatResponse;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      last = chunk;
      const content = chunk.message?.content ?? "";
      if (content) {
        accText += content;
        onToken(content);
      }
      for (const toolCall of chunk.message?.tool_calls ?? []) {
        const name = toolCall.function?.name ?? "";
        if (!name) continue;
        toolCalls.push({
          id: `ollama_tool_${toolCalls.length}`,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(toolCall.function?.arguments ?? {}),
          },
        });
      }
    }
  }

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: accText,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    meta: {
      provider,
      model: last.model,
      done_reason: last.done_reason,
    },
  };
}
