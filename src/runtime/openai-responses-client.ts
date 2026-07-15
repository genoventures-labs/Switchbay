import { getCloudProviderApiKey, getCloudProviderConfig } from "./cloud-providers";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ProviderArtifact,
  ProviderCitation,
  ProviderEnvelope,
  ProviderToolEvent,
  ToolCall,
} from "./types";

export type OpenAiManagedTool = "web_search" | "code_interpreter";

export type OpenAiResponsesClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  managedTools?: OpenAiManagedTool[];
};

type ResponseItem = Record<string, any>;

export class OpenAiResponsesClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly managedTools: OpenAiManagedTool[];

  constructor(options: OpenAiResponsesClientOptions = {}) {
    this.apiBase = options.apiBase ?? getCloudProviderConfig("openai").apiBase;
    this.apiKey = options.apiKey ?? getCloudProviderApiKey("openai");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.managedTools = [...new Set(options.managedTools ?? [])];
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: { onToken?: (token: string) => void } = {},
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey) throw new Error("Missing OPENAI_API_KEY");
    const stream = typeof options.onToken === "function";
    const response = await this.fetchImpl(`${this.apiBase}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: request.model ?? getCloudProviderConfig("openai").model,
        input: request.messages.flatMap(toResponseInput),
        tools: [
          ...(request.tools ?? []).map((tool) => ({
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters ?? { type: "object", properties: {} },
          })),
          ...this.managedTools.map(managedToolDefinition),
        ],
        ...(request.tool_choice === "none" ? { tool_choice: "none" } : { tool_choice: "auto" }),
        stream,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI Responses API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }
    if (stream) return readResponseStream(response, options.onToken!);
    const rawText = await response.text();
    const raw = JSON.parse(rawText);
    const normalized = normalizeResponse(raw);
    normalized._rawText = rawText;
    return normalized;
  }
}

function managedToolDefinition(tool: OpenAiManagedTool): Record<string, unknown> {
  return tool === "web_search"
    ? { type: "web_search_preview" }
    : { type: "code_interpreter", container: { type: "auto" } };
}

function toResponseInput(message: ChatMessage): ResponseItem[] {
  if (message.role === "tool") {
    return [{ type: "function_call_output", call_id: message.tool_call_id, output: contentText(message.content) }];
  }
  const items: ResponseItem[] = [];
  if (message.content !== "" && message.content != null) {
    items.push({ role: message.role, content: contentText(message.content) });
  }
  if (message.role === "assistant") {
    for (const call of message.tool_calls ?? []) {
      items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  return items;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  try { return JSON.stringify(content); } catch { return String(content ?? ""); }
}

function normalizeResponse(raw: any): ChatCompletionResponse {
  const parsed = parseItems(raw.output ?? []);
  return {
    id: raw.id,
    object: "chat.completion",
    output_text: parsed.text,
    choices: [{
      message: {
        role: "assistant",
        content: parsed.text || null,
        tool_calls: parsed.toolCalls.length ? parsed.toolCalls : undefined,
        provider_content: raw.output,
      },
      finish_reason: parsed.toolCalls.length ? "tool_calls" : incompleteReason(raw),
    }],
    provider: envelope(raw.id, parsed.events, parsed.citations, parsed.artifacts),
  };
}

function parseItems(items: ResponseItem[]): {
  text: string; toolCalls: ToolCall[]; events: ProviderToolEvent[]; citations: ProviderCitation[]; artifacts: ProviderArtifact[];
} {
  let text = "";
  const toolCalls: ToolCall[] = [];
  const events: ProviderToolEvent[] = [];
  const citations: ProviderCitation[] = [];
  const artifacts: ProviderArtifact[] = [];
  for (const item of items) {
    if (item.type === "function_call") {
      toolCalls.push({ id: item.call_id ?? item.id ?? "", type: "function", function: { name: item.name ?? "", arguments: item.arguments ?? "{}" } });
      continue;
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text") text += part.text ?? "";
        collectAnnotations(part.annotations ?? [], citations, artifacts);
      }
      continue;
    }
    if (item.type === "web_search_call" || item.type === "code_interpreter_call") {
      events.push({
        provider: "openai", server_managed: true, type: item.type, id: item.id,
        name: item.type === "web_search_call" ? "web_search" : "code_interpreter",
        status: normalizeStatus(item.status), input: item.action ?? item.code, output: item.results ?? item.outputs,
      });
      collectCodeArtifacts(item, artifacts);
    }
  }
  return { text, toolCalls, events, citations, artifacts };
}

function collectAnnotations(annotations: any[], citations: ProviderCitation[], artifacts: ProviderArtifact[]): void {
  for (const annotation of annotations) {
    if (annotation.type === "url_citation") {
      citations.push({ provider: "openai", url: annotation.url, title: annotation.title, start: annotation.start_index, end: annotation.end_index });
    } else if (annotation.type === "container_file_citation" || annotation.file_id) {
      artifacts.push({ provider: "openai", id: annotation.file_id, file_id: annotation.file_id, container_id: annotation.container_id, name: annotation.filename });
    }
  }
}

function collectCodeArtifacts(item: any, artifacts: ProviderArtifact[]): void {
  for (const output of item.outputs ?? []) {
    if (output.file_id || output.type === "file") {
      artifacts.push({ provider: "openai", id: output.file_id, file_id: output.file_id, container_id: item.container_id, name: output.filename, mime_type: output.mime_type });
    }
  }
}

function normalizeStatus(status: unknown): ProviderToolEvent["status"] {
  if (status === "completed" || status === "failed" || status === "paused") return status;
  return "started";
}

function incompleteReason(raw: any): string {
  if (raw.status === "incomplete") return raw.incomplete_details?.reason ?? "length";
  if (raw.status === "failed") return "error";
  return "stop";
}

function envelope(id: string | undefined, events: ProviderToolEvent[], citations: ProviderCitation[], artifacts: ProviderArtifact[]): ProviderEnvelope {
  return { events, citations, artifacts, ...(id ? { continuation: { provider: "openai", kind: "response_id", id } } : {}) };
}

async function readResponseStream(response: Response, onToken: (token: string) => void): Promise<ChatCompletionResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: any;
  let text = "";
  const items = new Map<string, ResponseItem>();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: any;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.type === "response.output_text.delta") {
        text += event.delta ?? "";
        onToken(event.delta ?? "");
      } else if (event.type === "response.output_item.added" && event.item) {
        items.set(event.item.id ?? String(event.output_index), event.item);
      } else if (event.type === "response.function_call_arguments.delta") {
        const key = event.item_id ?? String(event.output_index);
        const item = items.get(key) ?? { type: "function_call", id: key, call_id: event.call_id, name: event.name, arguments: "" };
        item.arguments = `${item.arguments ?? ""}${event.delta ?? ""}`;
        items.set(key, item);
      } else if (event.type === "response.output_item.done" && event.item) {
        items.set(event.item.id ?? String(event.output_index), event.item);
      } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
        completed = event.response;
      }
    }
  }
  if (completed?.output) return normalizeResponse(completed);
  const parsed = parseItems([...items.values()]);
  const finalText = text || parsed.text;
  return {
    id: completed?.id,
    output_text: finalText,
    choices: [{ message: { role: "assistant", content: finalText || null, tool_calls: parsed.toolCalls.length ? parsed.toolCalls : undefined }, finish_reason: parsed.toolCalls.length ? "tool_calls" : incompleteReason(completed ?? {}) }],
    provider: envelope(completed?.id, parsed.events, parsed.citations, parsed.artifacts),
  };
}
