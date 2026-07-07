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
    const provider = chooseProvider(request);
    const routedRequest: ChatCompletionRequest = {
      ...request,
      model: provider === "anthropic" ? getAnthropicModel() : getOpenAiModel(),
    };

    const response =
      provider === "anthropic"
        ? await this.anthropic.createChatCompletion(surface, routedRequest, options)
        : await this.openAi.createChatCompletion(surface, routedRequest, options);

    response.meta = {
      ...response.meta,
      provider,
    };
    return response;
  }
}

function chooseProvider(request: ChatCompletionRequest): ProviderName {
  const configured = getCloudProvider();
  if (configured === "openai" || configured === "anthropic") {
    assertProviderConfigured(configured);
    return configured;
  }

  const hasOpenAi = Boolean(getOpenAiApiKey());
  const hasAnthropic = Boolean(getAnthropicApiKey());
  if (!hasOpenAi && !hasAnthropic) {
    throw new Error("Missing cloud provider key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  }
  if (!hasOpenAi) return "anthropic";
  if (!hasAnthropic) return "openai";

  return shouldPreferAnthropic(request) ? "anthropic" : "openai";
}

function assertProviderConfigured(provider: ProviderName): void {
  if (provider === "openai" && !getOpenAiApiKey()) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (provider === "anthropic" && !getAnthropicApiKey()) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
}

function shouldPreferAnthropic(request: ChatCompletionRequest): boolean {
  const text = request.messages.map(messageText).join("\n").toLowerCase();

  if (/\b(json|schema|strict|format|classify|route|summari[sz]e|short|title)\b/.test(text)) {
    return false;
  }

  if (/\b(code|repo|repository|diff|patch|debug|fix|bug|test|build|refactor|implement|typescript|tsx|bun|shell|filesystem|workspace)\b/.test(text)) {
    return true;
  }

  return Boolean(request.tools?.length);
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
