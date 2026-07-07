import {
  getAnthropicApiKey,
  getAnthropicBase,
  getAnthropicModel,
  getDebugEmptyResponses,
} from "../config/env";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OriMessage,
  ToolCall,
  ToolDefinition,
} from "./types";

type AnthropicClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export class AnthropicClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicClientOptions = {}) {
    this.apiBase = options.apiBase ?? getAnthropicBase();
    this.apiKey = options.apiKey ?? getAnthropicApiKey();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: { onToken?: (token: string) => void } = {},
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY");
    }

    const useStream = typeof options.onToken === "function";
    const converted = convertMessages(request.messages);
    const response = await this.fetchImpl(`${this.apiBase}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model ?? getAnthropicModel(),
        max_tokens: 4096,
        ...(converted.system ? { system: converted.system } : {}),
        messages: converted.messages,
        stream: useStream,
        ...(request.tools && request.tools.length > 0 ? { tools: convertTools(request.tools) } : {}),
        ...(request.tool_choice !== undefined ? { tool_choice: convertToolChoice(request.tool_choice) } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }

    if (!useStream) {
      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as {
        content?: AnthropicContentBlock[];
        stop_reason?: string;
      };
      const normalized = normalizeAnthropicResponse(parsed);
      normalized._rawText = rawText;

      if (getDebugEmptyResponses()) {
        const text = normalized.choices?.[0]?.message?.content;
        const tools = normalized.choices?.[0]?.message?.tool_calls;
        if ((typeof text !== "string" || text.trim().length === 0) && !tools?.length) {
          console.error("[switchbay] empty-looking Anthropic response:");
          console.error(rawText);
        }
      }

      return normalized;
    }

    return readAnthropicStream(response, options.onToken!);
  }
}

function convertMessages(messages: OriMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = [];
  const converted: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = stringifyContent(message.content);
      if (text) system.push(text);
      continue;
    }

    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id ?? "",
            content: stringifyContent(message.content),
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      const text = stringifyContent(message.content);
      if (text) {
        blocks.push({ type: "text", text });
      }
      for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
      converted.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : "",
      });
      continue;
    }

    converted.push({
      role: "user",
      content: stringifyContent(message.content),
    });
  }

  return { system: system.join("\n\n"), messages: converted };
}

function convertTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));
}

function convertToolChoice(choice: ChatCompletionRequest["tool_choice"]) {
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (choice && typeof choice === "object") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function normalizeAnthropicResponse(response: { content?: AnthropicContentBlock[]; stop_reason?: string }): ChatCompletionResponse {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of response.content ?? []) {
    if (block.type === "text") {
      textParts.push(block.text);
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: textParts.join(""),
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : response.stop_reason ?? "stop",
      },
    ],
  };
}

async function readAnthropicStream(response: Response, onToken: (token: string) => void): Promise<ChatCompletionResponse> {
  let accText = "";
  const toolBlocks: Record<number, { id: string; name: string; inputJson: string }> = {};

  const reader = response.body!.getReader();
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
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let event: {
        type?: string;
        index?: number;
        content_block?: {
          type?: string;
          id?: string;
          name?: string;
        };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
        };
      };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const index = event.index ?? 0;
        toolBlocks[index] = {
          id: event.content_block.id ?? "",
          name: event.content_block.name ?? "",
          inputJson: "",
        };
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        accText += event.delta.text;
        onToken(event.delta.text);
      }

      if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        if (!toolBlocks[index]) {
          toolBlocks[index] = { id: "", name: "", inputJson: "" };
        }
        toolBlocks[index]!.inputJson += event.delta.partial_json ?? "";
      }
    }
  }

  const toolCalls = Object.entries(toolBlocks).map(([, block]) => ({
    id: block.id,
    type: "function" as const,
    function: {
      name: block.name,
      arguments: block.inputJson || "{}",
    },
  }));

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: accText || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
  };
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
