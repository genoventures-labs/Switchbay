import {
  getDebugEmptyResponses,
} from "../config/env";
import { getCloudProviderApiKey, getCloudProviderConfig } from "./cloud-providers";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ToolCall,
  ToolDefinition,
} from "./types";

type AnthropicClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  managedTools?: boolean;
};

type AnthropicContentBlock =
  | { type: "text"; text: string; citations?: unknown[] }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | Record<string, unknown>;

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  container?: { id?: string } & Record<string, unknown>;
};

const ANTHROPIC_SERVER_TOOLS = [
  { type: "web_search_20250305", name: "web_search" },
  { type: "web_fetch_20250910", name: "web_fetch" },
  { type: "code_execution_20250825", name: "code_execution" },
] as const;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export class AnthropicClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly managedTools: boolean;

  constructor(options: AnthropicClientOptions = {}) {
    const config = getCloudProviderConfig("anthropic");
    this.apiBase = options.apiBase ?? config.apiBase;
    this.apiKey = options.apiKey ?? getCloudProviderApiKey("anthropic");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.managedTools = options.managedTools ?? true;
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
        model: request.model ?? getCloudProviderConfig("anthropic").model,
        max_tokens: anthropicMaxTokens(),
        ...(converted.system ? { system: converted.system } : {}),
        messages: converted.messages,
        stream: useStream,
        ...buildToolsPayload(request, this.managedTools),
        ...(request.tool_choice !== undefined ? { tool_choice: convertToolChoice(request.tool_choice) } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }

    if (!useStream) {
      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as AnthropicResponse;
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

function convertMessages(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
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
      if (Array.isArray(message.provider_content)) {
        // Filter out thinking blocks with empty content — Anthropic rejects them on replay
        const replayBlocks = (message.provider_content as AnthropicContentBlock[]).filter(
          (b) => b.type !== "thinking" || (typeof (b as any).thinking === "string" && (b as any).thinking.length > 0)
        );
        converted.push({ role: "assistant", content: replayBlocks });
        continue;
      }
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

    // User message — handle plain text or multimodal content parts (vision)
    if (Array.isArray(message.content)) {
      const blocks: AnthropicContentBlock[] = [];
      for (const part of message.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
        if (part.type === "text" && part.text) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
            if (match) {
              blocks.push({
                type: "image",
                source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: match[2] },
              } as unknown as AnthropicContentBlock);
            }
          } else {
            blocks.push({
              type: "image",
              source: { type: "url", url },
            } as unknown as AnthropicContentBlock);
          }
        }
      }
      converted.push({ role: "user", content: blocks.length > 0 ? blocks : "" });
      continue;
    }

    converted.push({
      role: "user",
      content: stringifyContent(message.content),
    });
  }

  return { system: system.join("\n\n"), messages: converted };
}

function buildToolsPayload(request: ChatCompletionRequest, managedTools: boolean): { tools?: unknown[] } {
  const tools = request.tools?.length ? convertTools(request.tools) : [];
  if (managedTools && request.tool_choice !== "none") {
    const names = new Set(tools.map((tool) => String((tool as { name?: unknown }).name ?? "")));
    for (const serverTool of ANTHROPIC_SERVER_TOOLS) {
      if (!names.has(serverTool.name)) tools.push({ ...serverTool });
    }
  }
  return tools.length ? { tools } : {};
}

function convertTools(tools: ToolDefinition[]) {
  return tools.map((tool) => {
    if (tool.function.name === "native_exec") {
      return { type: "bash_20250124", name: "bash" };
    }
    if (tool.function.name === "native_editor") {
      return { type: "text_editor_20250728", name: "str_replace_based_edit_tool" };
    }
    return {
      name: tool.function.name,
      description: tool.function.description ?? "",
      input_schema: tool.function.parameters ?? { type: "object", properties: {} },
    };
  });
}

function convertToolChoice(choice: ChatCompletionRequest["tool_choice"]) {
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (choice && typeof choice === "object") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function normalizeAnthropicResponse(response: AnthropicResponse): ChatCompletionResponse {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const content = response.content ?? [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(String(block.text ?? ""));
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? ""),
        type: "function",
        function: {
          name: String(block.name ?? ""),
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
          provider_content: content,
        },
        finish_reason: normalizeAnthropicStopReason(response.stop_reason, toolCalls.length > 0),
      },
    ],
    provider: buildProviderEnvelope(content, response.stop_reason, response.container),
  };
}

async function readAnthropicStream(response: Response, onToken: (token: string) => void): Promise<ChatCompletionResponse> {
  let accText = "";
  const contentBlocks: Record<number, Record<string, unknown>> = {};
  const inputJson: Record<number, string> = {};
  let stopReason: string | undefined;
  let container: AnthropicResponse["container"];

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
        content_block?: Record<string, unknown>;
        message?: { container?: AnthropicResponse["container"] };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          stop_reason?: string;
          citation?: unknown;
        };
      };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      if (event.type === "message_start" && event.message?.container) {
        container = event.message.container;
      }

      if (event.type === "content_block_start" && event.content_block) {
        const index = event.index ?? 0;
        contentBlocks[index] = structuredClone(event.content_block);
        if (event.content_block.type === "tool_use" || event.content_block.type === "server_tool_use") {
          inputJson[index] = "";
        }
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        accText += event.delta.text;
        const index = event.index ?? 0;
        const block = contentBlocks[index] ?? (contentBlocks[index] = { type: "text", text: "" });
        block.text = String(block.text ?? "") + event.delta.text;
        onToken(event.delta.text);
      }

      if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && (event.delta as any).thinking) {
        const index = event.index ?? 0;
        const block = contentBlocks[index] ?? (contentBlocks[index] = { type: "thinking", thinking: "" });
        block.thinking = String(block.thinking ?? "") + String((event.delta as any).thinking);
      }

      if (event.type === "content_block_delta" && event.delta?.type === "signature_delta" && (event.delta as any).signature) {
        const index = event.index ?? 0;
        const block = contentBlocks[index];
        if (block) block.signature = (event.delta as any).signature;
      }

      if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        inputJson[index] = (inputJson[index] ?? "") + (event.delta.partial_json ?? "");
      }

      if (event.type === "content_block_delta" && event.delta?.type === "citations_delta" && event.delta.citation) {
        const index = event.index ?? 0;
        const block = contentBlocks[index] ?? (contentBlocks[index] = { type: "text", text: "" });
        const citations = Array.isArray(block.citations) ? block.citations : [];
        citations.push(event.delta.citation);
        block.citations = citations;
      }

      if (event.type === "message_delta" && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }
  }

  const content = Object.keys(contentBlocks)
    .map(Number)
    .sort((left, right) => left - right)
    .map((index) => {
      const block = contentBlocks[index]!;
      if ((block.type === "tool_use" || block.type === "server_tool_use") && inputJson[index] !== undefined) {
        block.input = parseJsonValue(inputJson[index] || "{}", block.input ?? {});
      }
      return block as AnthropicContentBlock;
    });
  const toolCalls = content.flatMap((block, index) => block.type === "tool_use"
    ? [{
        id: String(block.id ?? ""),
        type: "function" as const,
        function: {
          name: String(block.name ?? ""),
          arguments: inputJson[index] || JSON.stringify(block.input ?? {}),
        },
      }]
    : []);

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: accText || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          provider_content: content,
        },
        finish_reason: normalizeAnthropicStopReason(stopReason, toolCalls.length > 0),
      },
    ],
    provider: buildProviderEnvelope(content, stopReason, container),
  };
}

function clientToolCalls(content: AnthropicContentBlock[]): ToolCall[] {
  return content.flatMap((block) => block.type === "tool_use"
    ? [{
        id: String(block.id ?? ""),
        type: "function" as const,
        function: {
          name: String(block.name ?? ""),
          arguments: JSON.stringify(block.input ?? {}),
        },
      }]
    : []);
}

function buildProviderEnvelope(
  content: AnthropicContentBlock[],
  stopReason?: string,
  container?: AnthropicResponse["container"],
): NonNullable<ChatCompletionResponse["provider"]> {
  const events: NonNullable<ChatCompletionResponse["provider"]>["events"] = [];
  const citations: NonNullable<ChatCompletionResponse["provider"]>["citations"] = [];
  const artifacts: NonNullable<ChatCompletionResponse["provider"]>["artifacts"] = [];

  for (const block of content) {
    const record = block as Record<string, unknown>;
    const type = String(record.type ?? "");
    if (type === "server_tool_use") {
      events.push({
        provider: "anthropic",
        type,
        server_managed: true,
        id: optionalString(record.id),
        name: optionalString(record.name),
        status: "started",
        input: record.input,
      });
    } else if (type.endsWith("_tool_result")) {
      const failed = record.is_error === true || record.error !== undefined;
      events.push({
        provider: "anthropic",
        type,
        server_managed: true,
        id: optionalString(record.tool_use_id),
        status: failed ? "failed" : "completed",
        output: record.content ?? record.output ?? record,
      });
    }

    const blockCitations = Array.isArray(record.citations) ? record.citations : [];
    for (const value of blockCitations) {
      if (!value || typeof value !== "object") continue;
      const citation = value as Record<string, unknown>;
      citations.push({
        provider: "anthropic",
        url: optionalString(citation.url),
        title: optionalString(citation.title),
        start: optionalNumber(citation.start_char_index ?? citation.start),
        end: optionalNumber(citation.end_char_index ?? citation.end),
      });
    }
    collectArtifacts(block, artifacts, container?.id);
  }

  return {
    events,
    citations,
    artifacts,
    ...(stopReason === "pause_turn"
      ? { continuation: { provider: "anthropic" as const, kind: "pause_turn", id: container?.id, state: { content, container } } }
      : {}),
  };
}

function collectArtifacts(
  value: unknown,
  artifacts: NonNullable<ChatCompletionResponse["provider"]>["artifacts"],
  containerId?: string,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectArtifacts(item, artifacts, containerId);
    return;
  }
  const record = value as Record<string, unknown>;
  const fileId = optionalString(record.file_id);
  if (fileId && !artifacts.some((artifact) => artifact.file_id === fileId)) {
    artifacts.push({
      provider: "anthropic",
      file_id: fileId,
      id: optionalString(record.id),
      name: optionalString(record.name ?? record.filename),
      mime_type: optionalString(record.mime_type),
      container_id: optionalString(record.container_id) ?? containerId,
    });
  }
  for (const nested of Object.values(record)) collectArtifacts(nested, artifacts, containerId);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJsonValue(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function anthropicMaxTokens(): number {
  const configured = Number(Bun.env.SWITCHBAY_ANTHROPIC_MAX_TOKENS ?? 8192);
  if (!Number.isFinite(configured)) return 8192;
  return Math.max(1024, Math.min(32768, Math.trunc(configured)));
}

function normalizeAnthropicStopReason(reason: string | undefined, hasToolCalls: boolean): string {
  if (reason === "tool_use") return "tool_calls";
  if (reason) return reason;
  return hasToolCalls ? "tool_calls" : "stop";
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
