import {
  getDebugEmptyResponses,
  getDefaultModel,
  getLmStudioApiKey,
  getLmStudioNativeBase,
} from "../config/env";
import {
  loadLmStudioMcpConfig,
} from "./lmstudio-mcp-config";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from "./types";

type LmStudioMcpClientOptions = {
  apiBase?: string;
  apiKey?: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
};

type NativeChatOutputItem = {
  type?: string;
  content?: unknown;
  text?: unknown;
  tool?: string;
  name?: string;
  arguments?: unknown;
  output?: unknown;
  provider_info?: unknown;
};

type NativeChatResponse = {
  id?: string;
  output?: NativeChatOutputItem[];
  output_text?: string;
};

export class LmStudioMcpClient {
  private readonly apiBase?: string;
  private readonly apiKey?: string;
  private readonly cwd: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LmStudioMcpClientOptions = {}) {
    this.apiBase = options.apiBase;
    this.apiKey = options.apiKey ?? getLmStudioApiKey();
    this.cwd = options.cwd ?? process.cwd();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: { onToken?: (token: string) => void } = {},
  ): Promise<ChatCompletionResponse> {
    const configStatus = await loadLmStudioMcpConfig(this.cwd);
    const config = configStatus.config;
    if (config.enabled === false) {
      throw new Error(`LM Studio MCP lane is disabled in ${configStatus.path}.`);
    }

    const apiBase = this.apiBase ?? config.nativeBase ?? getLmStudioNativeBase();
    const integrations = configStatus.integrations;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${apiBase}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model ?? config.model ?? getDefaultModel(),
        input: messagesToInput(request.messages),
        ...(config.systemPrompt ? { system_prompt: config.systemPrompt } : {}),
        ...(config.contextLength ? { context_length: config.contextLength } : {}),
        ...(integrations.length > 0 ? { integrations } : {}),
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `LM Studio MCP API error: ${response.status}${body ? ` - ${body}` : ""}`,
      );
    }

    const rawText = await response.text();
    const parsed = JSON.parse(rawText) as NativeChatResponse;
    const content = extractNativeOutputText(parsed);
    if (options.onToken && content) {
      options.onToken(content);
    }

    if (getDebugEmptyResponses() && !content.trim()) {
      console.error("[switchbay] empty-looking LM Studio MCP response:");
      console.error(rawText);
    }

    return {
      id: parsed.id,
      choices: [
        {
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      output_text: content,
      _rawText: rawText,
      meta: {
        provider: "lmstudio-mcp",
        lmstudio_tool_calls: extractNativeToolCallSummaries(parsed.output ?? []),
      },
    };
  }
}

function messagesToInput(messages: ChatMessage[]): Array<{ role: string; content: unknown }> {
  const normalized = messages
    .filter((message) => message.role !== "tool")
    .map((message) => ({
      role: message.role === "system" ? "system" : message.role,
      content: message.content,
    }));

  return [
    ...normalized,
    {
      role: "system",
      content: [
        "LM STUDIO MCP LANE:",
        "Use LM Studio's configured MCP integrations for tool access in this turn.",
        "Do not attempt Switchbay function-tool calls in this lane; they are not sent through the native LM Studio MCP API.",
        "If the required MCP server or tool is unavailable, say exactly what is missing.",
      ].join("\n"),
    },
  ];
}

function extractNativeOutputText(response: NativeChatResponse): string {
  const outputText = extractText(response.output_text);
  if (outputText) return outputText;

  return (response.output ?? [])
    .filter((item) => item.type === "message" || item.type === "text" || !item.type)
    .map((item) => extractText(item.content) || extractText(item.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractText(record.text) || extractText(record.content) || extractText(record.value);
  }
  return "";
}

function extractNativeToolCallSummaries(output: NativeChatOutputItem[]): string[] {
  return output
    .filter((item) => item.type === "tool_call")
    .map((item) => item.tool ?? item.name ?? "tool_call")
    .filter(Boolean);
}
