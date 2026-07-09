import {
  getAnthropicApiKey,
  getAnthropicModel,
  getCloudProvider,
  getOpenAiApiKey,
  getOpenAiModel,
  type CloudProvider,
} from "../config/env";
import { AnthropicClient } from "./anthropic-client";
import { OpenAiClient } from "./openai-client";
import type { ChatRuntimeClient } from "./client";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage, WorkspaceFocus } from "./types";

type ProviderName = Exclude<CloudProvider, "auto">;

type CloudRouterClientOptions = {
  openAi?: ChatRuntimeClient;
  anthropic?: ChatRuntimeClient;
};

type RoutingIntent = "structured_output" | "code_work" | "tool_work" | "general";

type CloudRoutingDecision = {
  provider: ProviderName;
  model: string;
  intent: RoutingIntent;
  reason: string;
  mode: "explicit" | "auto" | "availability";
};

export class CloudRouterClient implements ChatRuntimeClient {
  private readonly openAi: ChatRuntimeClient;
  private readonly anthropic: ChatRuntimeClient;

  constructor(options: CloudRouterClientOptions = {}) {
    this.openAi = options.openAi ?? new OpenAiClient();
    this.anthropic = options.anthropic ?? new AnthropicClient();
  }

  async createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options: {
      sessionId?: string;
      operator?: boolean;
      sendEnv?: boolean;
      workspace?: WorkspaceFocus;
      onToken?: (token: string) => void;
    } = {},
  ): Promise<ChatCompletionResponse> {
    const decision = chooseProvider(request);
    const routedRequest: ChatCompletionRequest = {
      ...request,
      model: decision.model,
    };

    const response =
      decision.provider === "anthropic"
        ? await this.anthropic.createChatCompletion(surface, routedRequest, options)
        : await this.openAi.createChatCompletion(surface, routedRequest, options);

    response.meta = {
      ...response.meta,
      provider: decision.provider,
      model: decision.model,
      router_intent: decision.intent,
      router_reason: decision.reason,
      router_mode: decision.mode,
      using: `cloud/${decision.provider}/${decision.model}`,
    };
    return response;
  }
}

function chooseProvider(request: ChatCompletionRequest): CloudRoutingDecision {
  const configured = getCloudProvider();
  if (configured === "openai" || configured === "anthropic") {
    assertProviderConfigured(configured);
    return {
      provider: configured,
      model: configured === "anthropic" ? getAnthropicModel() : getOpenAiModel(),
      intent: classifyIntent(request).intent,
      reason: `Explicit cloud provider: ${configured}.`,
      mode: "explicit",
    };
  }

  const hasOpenAi = Boolean(getOpenAiApiKey());
  const hasAnthropic = Boolean(getAnthropicApiKey());
  if (!hasOpenAi && !hasAnthropic) {
    throw new Error("Missing cloud provider key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  }
  if (!hasOpenAi) {
    return {
      provider: "anthropic",
      model: getAnthropicModel(),
      intent: classifyIntent(request).intent,
      reason: "Only Anthropic key is configured.",
      mode: "availability",
    };
  }
  if (!hasAnthropic) {
    return {
      provider: "openai",
      model: getOpenAiModel(),
      intent: classifyIntent(request).intent,
      reason: "Only OpenAI key is configured.",
      mode: "availability",
    };
  }

  const classified = classifyIntent(request);
  const provider = classified.intent === "code_work" || classified.intent === "tool_work"
    ? "anthropic"
    : "openai";
  return {
    provider,
    model: provider === "anthropic" ? getAnthropicModel() : getOpenAiModel(),
    intent: classified.intent,
    reason: classified.reason,
    mode: "auto",
  };
}

function assertProviderConfigured(provider: ProviderName): void {
  if (provider === "openai" && !getOpenAiApiKey()) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (provider === "anthropic" && !getAnthropicApiKey()) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
}

function classifyIntent(request: ChatCompletionRequest): { intent: RoutingIntent; reason: string } {
  const text = request.messages.map(messageText).join("\n").toLowerCase();

  if (/\b(json|schema|strict|format|classify|route|summari[sz]e|short|title)\b/.test(text)) {
    return { intent: "structured_output", reason: "Structured/summary keywords favor OpenAI." };
  }

  if (/\b(code|repo|repository|diff|patch|debug|fix|bug|test|build|refactor|implement|typescript|tsx|bun|shell|filesystem|workspace)\b/.test(text)) {
    return { intent: "code_work", reason: "Code/workspace keywords favor Anthropic." };
  }

  if (request.tools?.length) {
    return { intent: "tool_work", reason: "Tool-enabled turn favors Anthropic." };
  }

  return { intent: "general", reason: "General cloud prompt defaults to OpenAI." };
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  if (message.content == null) return "";
  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}
