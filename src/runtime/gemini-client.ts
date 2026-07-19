import { getCloudProviderApiKey, getCloudProviderConfig } from "./cloud-providers";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ProviderEnvelope,
  ToolCall,
  ToolDefinition,
} from "./types";

type GeminiClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: unknown };
  functionResponse?: { id?: string; name?: string; response?: unknown };
  executableCode?: unknown;
  codeExecutionResult?: unknown;
  [key: string]: unknown;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
    groundingMetadata?: Record<string, unknown>;
    urlContextMetadata?: unknown;
  }>;
};

export class GeminiClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiClientOptions = {}) {
    const config = getCloudProviderConfig("google");
    this.apiBase = nativeGeminiBase(options.apiBase ?? config.apiBase);
    this.apiKey = options.apiKey ?? getCloudProviderApiKey("google");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(
    _surface: string,
    request: ChatCompletionRequest,
    options: { onToken?: (token: string) => void } = {},
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey) throw new Error("Missing GOOGLE_API_KEY or GEMINI_API_KEY");
    const model = request.model ?? getCloudProviderConfig("google").model;
    const converted = convertMessages(request.messages);
    const stream = typeof options.onToken === "function";
    const method = stream ? "streamGenerateContent" : "generateContent";
    const url = new URL(`${this.apiBase}/models/${encodeURIComponent(model)}:${method}`);
    url.searchParams.set("key", this.apiKey);
    if (stream) url.searchParams.set("alt", "sse");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(converted.systemInstruction ? { systemInstruction: converted.systemInstruction } : {}),
        contents: converted.contents,
        tools: [
          ...(request.tools?.length ? [{ functionDeclarations: convertTools(request.tools) }] : []),
          { googleSearch: {} },
          { urlContext: {} },
          { codeExecution: {} },
        ],
        ...(request.tool_choice !== undefined
          ? { toolConfig: { functionCallingConfig: convertToolChoice(request.tool_choice) } }
          : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini API error: ${response.status}${body ? ` - ${body}` : ""}`);
    }

    if (!stream) {
      const rawText = await response.text();
      const normalized = normalizeGeminiResponse(JSON.parse(rawText) as GeminiResponse);
      normalized._rawText = rawText;
      return normalized;
    }
    return readGeminiStream(response, options.onToken!);
  }
}

function convertMessages(messages: ChatMessage[]) {
  const system: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  const callNames = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "system") {
      const text = stringifyContent(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === "tool") {
      const name = callNames.get(message.tool_call_id ?? "") ?? message.tool_call_id ?? "tool";
      contents.push({ role: "user", parts: [{ functionResponse: {
        ...(message.tool_call_id ? { id: message.tool_call_id } : {}),
        name,
        response: { result: contentValue(message.content) },
      } }] });
      continue;
    }
    if (message.role === "assistant") {
      const nativeParts = providerParts(message.provider_content);
      const parts: GeminiPart[] = nativeParts ? nativeParts.map((part) => ({ ...part })) : [];
      if (!nativeParts) {
        const text = stringifyContent(message.content);
        if (text) parts.push({ text });
        for (const call of message.tool_calls ?? []) {
          callNames.set(call.id, call.function.name);
          parts.push({ functionCall: {
            id: call.id,
            name: call.function.name,
            args: parseJson(call.function.arguments),
          } });
        }
      } else {
        for (const part of parts) {
          if (part.functionCall?.id && part.functionCall.name) callNames.set(part.functionCall.id, part.functionCall.name);
        }
      }
      contents.push({ role: "model", parts });
      continue;
    }
    // User message — handle multimodal content parts (vision)
    if (Array.isArray(message.content)) {
      const parts: GeminiPart[] = [];
      for (const part of message.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          } else {
            parts.push({ fileData: { fileUri: url } });
          }
        }
      }
      contents.push({ role: "user", parts: parts.length > 0 ? parts : [{ text: "" }] });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: stringifyContent(message.content) }] });
  }
  return {
    systemInstruction: system.length ? { parts: [{ text: system.join("\n\n") }] } : undefined,
    contents,
  };
}

function convertTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    parameters: tool.function.parameters ?? { type: "object", properties: {} },
  }));
}

function convertToolChoice(choice: ChatCompletionRequest["tool_choice"]) {
  if (choice === "none") return { mode: "NONE" };
  if (choice === "auto") return { mode: "AUTO" };
  if (choice && typeof choice === "object") return { mode: "ANY", allowedFunctionNames: [choice.function.name] };
  return { mode: "AUTO" };
}

function normalizeGeminiResponse(response: GeminiResponse): ChatCompletionResponse {
  const candidate = response.candidates?.[0];
  return normalizeCandidate(candidate);
}

function normalizeCandidate(candidate?: GeminiResponse["candidates"] extends Array<infer T> | undefined ? T : never): ChatCompletionResponse {
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
  const toolCalls: ToolCall[] = [];
  parts.forEach((part, index) => {
    if (!part.functionCall?.name) return;
    toolCalls.push({
      id: part.functionCall.id ?? `gemini-call-${index}`,
      type: "function",
      function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
    });
  });
  return {
    choices: [{
      message: {
        role: "assistant",
        content: text,
        provider_content: parts,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: toolCalls.length ? "tool_calls" : normalizeFinishReason(candidate?.finishReason),
    }],
    provider: providerEnvelope(candidate),
  };
}

async function readGeminiStream(response: Response, onToken: (token: string) => void): Promise<ChatCompletionResponse> {
  const parts: GeminiPart[] = [];
  const metadataCandidates: NonNullable<GeminiResponse["candidates"]> = [];
  let finishReason: string | undefined;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Gemini streaming response had no body");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("data:")) continue;
      const payload = line.trim().slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk: GeminiResponse;
      try { chunk = JSON.parse(payload); } catch { continue; }
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;
      metadataCandidates.push(candidate);
      finishReason = candidate.finishReason ?? finishReason;
      for (const part of candidate.content?.parts ?? []) {
        parts.push(part);
        if (typeof part.text === "string" && !part.thought) onToken(part.text);
      }
    }
    if (done) break;
  }
  const merged = {
    content: { role: "model", parts },
    finishReason,
    groundingMetadata: mergeObjectField(metadataCandidates, "groundingMetadata"),
    urlContextMetadata: metadataCandidates.map((item) => item.urlContextMetadata).find(Boolean),
  };
  return normalizeCandidate(merged);
}

function providerEnvelope(candidate: Record<string, any> | undefined): ProviderEnvelope {
  const envelope: ProviderEnvelope = { events: [], citations: [], artifacts: [] };
  const metadata = candidate?.groundingMetadata as Record<string, any> | undefined;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const seen = new Set<string>();
  for (const support of Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : []) {
    for (const index of support.groundingChunkIndices ?? []) {
      const web = chunks[index]?.web;
      if (!web?.uri || seen.has(`${web.uri}:${support.segment?.startIndex}:${support.segment?.endIndex}`)) continue;
      seen.add(`${web.uri}:${support.segment?.startIndex}:${support.segment?.endIndex}`);
      envelope.citations.push({ provider: "google", url: web.uri, title: web.title, start: support.segment?.startIndex, end: support.segment?.endIndex });
    }
  }
  if (Array.isArray(metadata?.webSearchQueries) || metadata?.searchEntryPoint) {
    envelope.events.push({ provider: "google", type: "google_search", server_managed: true, status: "completed", input: metadata.webSearchQueries, output: metadata.searchEntryPoint });
  }
  if (candidate?.urlContextMetadata) {
    envelope.events.push({ provider: "google", type: "url_context", server_managed: true, status: "completed", output: candidate.urlContextMetadata });
  }
  for (const part of candidate?.content?.parts ?? []) {
    if (part.executableCode !== undefined) envelope.events.push({ provider: "google", type: "code_execution", server_managed: true, status: "started", input: part.executableCode });
    if (part.codeExecutionResult !== undefined) envelope.events.push({ provider: "google", type: "code_execution", server_managed: true, status: "completed", output: part.codeExecutionResult });
  }
  return envelope;
}

function nativeGeminiBase(base: string): string {
  return base.replace(/\/openai\/?$/, "").replace(/\/$/, "");
}

function providerParts(content: unknown): GeminiPart[] | null {
  if (Array.isArray(content)) return content as GeminiPart[];
  if (content && typeof content === "object" && Array.isArray((content as any).parts)) return (content as any).parts;
  return null;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try { return JSON.stringify(content); } catch { return String(content); }
}

function contentValue(content: unknown): unknown {
  if (typeof content !== "string") return content;
  return parseJson(content, content);
}

function parseJson(value: string, fallback: unknown = {}): unknown {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function normalizeFinishReason(reason?: string): string {
  if (!reason || reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  return reason.toLowerCase();
}

function mergeObjectField(items: Array<Record<string, any>>, key: string): Record<string, unknown> | undefined {
  const values = items.map((item) => item[key]).filter((value) => value && typeof value === "object");
  if (!values.length) return undefined;
  return Object.assign({}, ...values);
}
