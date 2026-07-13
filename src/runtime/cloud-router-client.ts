import {
  getActiveCloudProvider,
  getCloudProviderConfig,
  hasCloudProviderKey,
  type CloudProviderId,
} from "./cloud-providers";
import { AnthropicClient } from "./anthropic-client";
import { OpenAiClient } from "./openai-client";
import { containsImageReferenceText } from "./image-inputs";
import type { ChatRuntimeClient } from "./client";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage, WorkspaceFocus } from "./types";

type ProviderName = CloudProviderId;

type CloudRouterClientOptions = {
  openAi?: ChatRuntimeClient;
  anthropic?: ChatRuntimeClient;
  google?: ChatRuntimeClient;
};

type RoutingIntent = "vision" | "structured_output" | "code_work" | "tool_work" | "research" | "general";

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
  private readonly google: ChatRuntimeClient;

  constructor(options: CloudRouterClientOptions = {}) {
    this.openAi = options.openAi ?? new OpenAiClient();
    this.anthropic = options.anthropic ?? new AnthropicClient();
    this.google = options.google ?? new OpenAiClient({ provider: "google" });
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

    const providerClient = decision.provider === "anthropic"
      ? this.anthropic
      : decision.provider === "google"
        ? this.google
        : this.openAi;
    const response = await providerClient.createChatCompletion(surface, routedRequest, options);

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
  const configured = getActiveCloudProvider();
  const classified = classifyIntent(request);
  if (configured === "openai" || configured === "anthropic" || configured === "google") {
    if (classified.intent === "vision" && configured !== "openai") {
      throw new Error("Image URL vision is currently wired for OpenAI. Switch with `/lane openai` or `switchbay cloud-provider set openai`.");
    }
    assertProviderConfigured(configured);
    return {
      provider: configured,
      model: getCloudProviderConfig(configured).model,
      intent: classified.intent,
      reason: `Explicit cloud provider: ${configured}.`,
      mode: "explicit",
    };
  }

  if (classified.intent === "vision") {
    assertProviderConfigured("openai");
    return {
      provider: "openai",
      model: getCloudProviderConfig("openai").model,
      intent: classified.intent,
      reason: classified.reason,
      mode: "auto",
    };
  }

  const hasOpenAi = hasCloudProviderKey("openai");
  const hasAnthropic = hasCloudProviderKey("anthropic");
  const hasGoogle = hasCloudProviderKey("google");
  if (!hasOpenAi && !hasAnthropic && !hasGoogle) {
    throw new Error("Missing cloud provider key. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.");
  }
  const configuredProviders = [
    hasOpenAi ? "openai" : null,
    hasAnthropic ? "anthropic" : null,
    hasGoogle ? "google" : null,
  ].filter((provider): provider is ProviderName => Boolean(provider));
  if (configuredProviders.length === 1) {
    const provider = configuredProviders[0]!;
    return {
      provider,
      model: getCloudProviderConfig(provider).model,
      intent: classifyIntent(request).intent,
      reason: `Only ${getCloudProviderConfig(provider).label} key is configured.`,
      mode: "availability",
    };
  }

  const provider = classified.intent === "code_work" || classified.intent === "tool_work"
    ? firstAvailable(["anthropic", "openai", "google"])
    : classified.intent === "research"
      ? firstAvailable(["google", "openai", "anthropic"])
      : firstAvailable(["openai", "google", "anthropic"]);
  return {
    provider,
    model: getCloudProviderConfig(provider).model,
    intent: classified.intent,
    reason: classified.reason,
    mode: "auto",
  };
}

function firstAvailable(preferences: ProviderName[]): ProviderName {
  const selected = preferences.find((provider) => hasCloudProviderKey(provider));
  if (!selected) {
    throw new Error("Missing cloud provider key. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.");
  }
  return selected;
}

function assertProviderConfigured(provider: ProviderName): void {
  if (!hasCloudProviderKey(provider)) {
    throw new Error(`Missing ${getCloudProviderConfig(provider).apiKeyEnv}`);
  }
}

function classifyIntent(request: ChatCompletionRequest): { intent: RoutingIntent; reason: string } {
  const latestUserMessage = [...request.messages].reverse().find((message) => message.role === "user");
  const text = latestUserMessage ? messageText(latestUserMessage).toLowerCase() : "";

  if (containsImageReferenceText(text)) {
    return { intent: "vision", reason: "Image references favor OpenAI vision input." };
  }

  if (/\b(code|repo|repository|diff|patch|debug|fix|bug|test|build|refactor|implement|typescript|tsx|bun|shell|filesystem|workspace)\b/.test(text)) {
    return { intent: "code_work", reason: "Code/workspace keywords favor Anthropic." };
  }

  if (/\b(json|schema|strict(?:ly)?|structured output|return only|respond only)\b/.test(text) ||
      /\b(format|classify|summari[sz]e|title)\b.{0,40}\b(as|into|with|using)\b/.test(text)) {
    return { intent: "structured_output", reason: "Explicit structured-output instruction favors OpenAI." };
  }

  if (/\b(research|compare|analy[sz]e|investigate|synthesize|long context|many files|large document|deep dive)\b/.test(text)) {
    return { intent: "research", reason: "Research and long-context work favors Gemini." };
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
