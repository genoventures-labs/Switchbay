import {
  getDebugEmptyResponses,
  getDefaultModel,
  getLmStudioApiKey,
  getLmStudioNativeBase,
} from "../config/env";
import {
  loadLmStudioMcpConfig,
  formatIntegrationLabel,
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

type NativeChatPayload = {
  input: string;
  systemPrompt?: string;
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
    const nativePayload = messagesToNativePayload(
      request.messages,
      config.systemPrompt,
      integrations.map(formatIntegrationLabel),
    );

    const response = await this.fetchImpl(`${apiBase}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model ?? config.model ?? getDefaultModel(),
        input: nativePayload.input,
        ...(nativePayload.systemPrompt ? { system_prompt: nativePayload.systemPrompt } : {}),
        ...(config.contextLength ? { context_length: config.contextLength } : {}),
        ...(integrations.length > 0 ? { integrations } : {}),
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(formatLmStudioMcpError(response.status, body));
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

function messagesToNativePayload(
  messages: ChatMessage[],
  configSystemPrompt?: string,
  integrations: string[] = [],
): NativeChatPayload {
  const systemParts = [
    ...messages
      .filter((message) => message.role === "system")
      .map((message) => stringifyMessageContent(message.content))
      .filter(Boolean),
    configSystemPrompt?.trim() ?? "",
    [
      "LM STUDIO MCP LANE:",
      "Use LM Studio's configured MCP integrations for tool access in this turn.",
      `Configured integrations: ${integrations.length ? integrations.join(", ") : "none"}.`,
      "Do not attempt Switchbay function-tool calls in this lane; they are not sent through the native LM Studio MCP API.",
      "If the required MCP server or tool is unavailable, say exactly what is missing.",
    ].join("\n"),
  ].filter(Boolean);

  const input = messages
    .filter((message) => message.role !== "system" && message.role !== "tool")
    .map((message) => `${message.role.toUpperCase()}: ${stringifyMessageContent(message.content)}`)
    .filter((line) => line.trim().length > 0)
    .join("\n\n")
    .trim();

  return {
    input: input || "Continue.",
    systemPrompt: systemParts.join("\n\n"),
  };
}

function formatLmStudioMcpError(status: number, body: string): string {
  const raw = body.trim();
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        message?: string;
        type?: string;
        param?: string;
      };
    };
    const error = parsed.error;
    const message = error?.message ?? raw;
    if (error?.type === "plugin_connection_error" || message.includes("Cannot find plugin handle")) {
      const match = message.match(/'([^']+)'/);
      const plugin = match?.[1] ?? "the configured MCP integration";
      return [
        `LM Studio MCP API error: ${status}.`,
        `LM Studio could not find MCP plugin \`${plugin}\`.`,
        "Open LM Studio, confirm that MCP server is installed/enabled in its mcp.json, then set the matching id in `.switchbay/lmstudio.mcp.json` under `integrations`.",
        "If you do not have that server configured yet, remove it from `integrations` or run `switchbay mcp init` to start from an empty config.",
      ].join(" ");
    }
  } catch {
    // Fall through to the raw response.
  }

  return `LM Studio MCP API error: ${status}${raw ? ` - ${raw}` : ""}`;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(stringifyMessageContent).filter(Boolean).join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (record.text || record.content || record.value) {
      return stringifyMessageContent(record.text ?? record.content ?? record.value);
    }
  }
  return content == null ? "" : String(content);
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
