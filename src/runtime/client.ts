import { getRuntimeLane, type RuntimeLane } from "../config/env";
import { AnthropicClient } from "./anthropic-client";
import { AppleFmClient } from "./apple-fm-client";
import type { AppleVariant } from "./apple-fm-client";
import { CloudRouterClient } from "./cloud-router-client";
import { getCloudProviderConfig, type CloudProviderId } from "./cloud-providers";
import { getActiveLocalProvider, getLocalProviderConfig, type LocalProviderId } from "./local-providers";
import { OllamaClient } from "./ollama-client";
import { OpenAiClient } from "./openai-client";
import { OpenAiResponsesClient } from "./openai-responses-client";
import { GeminiClient } from "./gemini-client";
import type { ChatCompletionRequest, ChatCompletionResponse, WorkspaceFocus } from "./types";
import { readConfiguredSecret } from "../config/secrets";
import { getNativeToolsConfig } from "../config/switchbay-config";
import { getLocalMode } from "../config/local-mode";
import { recordOpenRouterRequest } from "./openrouter-rate-limiter";

export type ChatRuntimeClient = {
  createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options?: {
      sessionId?: string;
      operator?: boolean;
      sendEnv?: boolean;
      workspace?: WorkspaceFocus;
      onToken?: (token: string) => void;
    },
  ): Promise<ChatCompletionResponse>;
};

export type RuntimeClientOptions = {
  model?: string | null;
  provider?: CloudProviderId | null;
  localProvider?: LocalProviderId | null;
  /** Called when Apple FM auto-routing would escalate to a cloud variant in local mode. */
  onAppleEscalationConfirm?: (targetVariant: AppleVariant) => Promise<boolean>;
};

export function createRuntimeClient(
  lane: RuntimeLane = getRuntimeLane(),
  options: RuntimeClientOptions = {},
): ChatRuntimeClient {
  const model = options.model?.trim() || undefined;
  const providerManagedTools = getNativeToolsConfig().providerManaged;
  let client: ChatRuntimeClient;
  let using: string | null = null;
  let routerIntent: string | null = null;
  let routerReason: string | null = null;
  let routerMode: string | null = null;
  const localMode = getLocalMode();
  if (lane === "apple") {
    const appleModel = model ?? Bun.env.SWITCHBAY_APPLE_FM_MODEL?.trim() ?? "default";
    client = new AppleFmClient({ model: appleModel, localMode, onEscalationConfirm: options.onAppleEscalationConfirm });
    using = `local/apple-fm/${appleModel}`;
    routerIntent = "local_provider";
    routerReason = "Apple Intelligence (on-device) selected.";
    routerMode = "explicit";
    return new RuntimeRouteTagClient(client, {
      using,
      provider: "apple-fm",
      model: appleModel,
      routerIntent,
      routerReason,
      routerMode,
    });
  } else if (lane === "local") {
    const localProvider = options.localProvider ?? getActiveLocalProvider();
    if (localProvider === "ollama-cloud" && !readConfiguredSecret("OLLAMA_API_KEY")) throw new Error("Missing OLLAMA_API_KEY");
    if (localProvider === "apple-fm") {
      const appleModel = model ?? getLocalProviderConfig("apple-fm").model ?? "default";
      client = new AppleFmClient({ model: appleModel, localMode, onEscalationConfirm: options.onAppleEscalationConfirm });
      using = `local/apple-fm/${appleModel}`;
      routerIntent = "local_provider";
      routerReason = "Apple Intelligence (on-device) selected via local lane.";
      routerMode = options.localProvider ? "explicit" : "configured";
      return new RuntimeRouteTagClient(client, {
        using,
        provider: "apple-fm",
        model: appleModel,
        routerIntent,
        routerReason,
        routerMode,
      });
    }
    if (localProvider === "llama-cpp" || localProvider === "mlx") {
      const config = getLocalProviderConfig(localProvider);
      const activeModel = model ?? config.model ?? undefined;
      const apiKey = (localProvider === "llama-cpp"
        ? Bun.env.LLAMA_CPP_API_KEY
        : Bun.env.MLX_API_KEY) ?? "sk-local";
      client = new OpenAiClient({ apiBase: config.apiBase, apiKey, apiLabel: config.label });
      using = `local/${localProvider}/${activeModel ?? "default"}`;
      routerIntent = "local_provider";
      routerReason = `${config.label} selected.`;
      routerMode = options.localProvider ? "explicit" : "configured";
      const tagged = new RuntimeRouteTagClient(
        activeModel ? new ModelOverrideClient(client, activeModel) : client,
        { using, provider: localProvider, model: activeModel ?? "default", routerIntent, routerReason, routerMode },
      );
      return tagged;
    }
    client = new OllamaClient({ provider: localProvider as "ollama" | "ollama-cloud" });
    const config = getLocalProviderConfig(localProvider);
    using = `${localProvider === "ollama-cloud" ? "cloud/ollama" : "local/ollama"}/${model ?? config.model ?? "default"}`;
    routerIntent = "local_provider";
    routerReason = `${config.label} selected.`;
    routerMode = options.localProvider ? "explicit" : "configured";
  } else if (lane === "openrouter") {
    const apiKey = readConfiguredSecret("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");
    const openRouterModel = model ?? Bun.env.SWITCHBAY_OPENROUTER_MODEL?.trim() ?? "openai/gpt-5.2";
    client = new OpenAiClient({
      apiBase: Bun.env.SWITCHBAY_OPENROUTER_BASE?.trim() ?? "https://openrouter.ai/api/v1",
      apiKey,
      apiLabel: "OpenRouter",
      extraHeaders: {
        "HTTP-Referer": Bun.env.SWITCHBAY_OPENROUTER_REFERER?.trim() ?? "https://github.com/genoventures-labs/Switchbay",
        "X-OpenRouter-Title": Bun.env.SWITCHBAY_OPENROUTER_TITLE?.trim() ?? "Switchbay",
      },
    });
    using = `cloud/openrouter/${openRouterModel}`;
    routerIntent = "explicit_provider";
    routerReason = "Explicit OpenRouter lane selected.";
    routerMode = "explicit";
    return new RuntimeRouteTagClient(
      new OpenRouterRateLimitClient(new ModelOverrideClient(client, openRouterModel)),
      { using, provider: "openrouter", model: openRouterModel, routerIntent, routerReason, routerMode },
    );
  } else if (lane === "huggingface") {
    const apiKey = readConfiguredSecret("HF_TOKEN", "HUGGINGFACE_API_KEY");
    if (!apiKey) throw new Error("Missing HF_TOKEN");
    const huggingFaceModel = model ?? Bun.env.SWITCHBAY_HF_MODEL?.trim() ?? "openai/gpt-oss-120b:groq";
    client = new OpenAiClient({
      apiBase: Bun.env.SWITCHBAY_HF_BASE?.trim() ?? "https://router.huggingface.co/v1",
      apiKey,
      apiLabel: "Hugging Face Inference Providers",
    });
    return new RuntimeRouteTagClient(new ModelOverrideClient(client, huggingFaceModel), {
      using: `cloud/huggingface/${huggingFaceModel}`,
      provider: "huggingface",
      model: huggingFaceModel,
      routerIntent: "explicit_provider",
      routerReason: "Explicit contained Hugging Face lane selected.",
      routerMode: "explicit",
    });
  } else if (options.provider === "openai") {
    client = providerManagedTools
      ? new OpenAiResponsesClient({ managedTools: ["web_search", "code_interpreter"] })
      : new OpenAiClient();
    const config = getCloudProviderConfig("openai");
    using = `cloud/openai/${model ?? config.model}`;
    routerIntent = "explicit_provider";
    routerReason = `Explicit cloud provider selected: ${config.label}.`;
    routerMode = "explicit";
  } else if (options.provider === "anthropic") {
    client = new AnthropicClient({ managedTools: providerManagedTools });
    const config = getCloudProviderConfig("anthropic");
    using = `cloud/anthropic/${model ?? config.model}`;
    routerIntent = "explicit_provider";
    routerReason = `Explicit cloud provider selected: ${config.label}.`;
    routerMode = "explicit";
  } else if (options.provider === "google") {
    client = providerManagedTools ? new GeminiClient() : new OpenAiClient({ provider: "google" });
    const config = getCloudProviderConfig("google");
    using = `cloud/google/${model ?? config.model}`;
    routerIntent = "explicit_provider";
    routerReason = `Explicit cloud provider selected: ${config.label}.`;
    routerMode = "explicit";
  } else {
    client = new CloudRouterClient();
  }

  const withModel = model ? new ModelOverrideClient(client, model) : client;

  return using
    ? new RuntimeRouteTagClient(withModel, {
        using,
        provider: options.provider ?? undefined,
        model: model ?? (options.provider ? getCloudProviderConfig(options.provider).model : undefined),
        routerIntent,
        routerReason,
        routerMode,
      })
    : withModel;
}

export function getRuntimeLaneLabel(lane: RuntimeLane = getRuntimeLane()): string {
  if (lane === "cloud-mcp") return "Cloud + MCP Bridge";
  if (lane === "local") return "Ollama";
  if (lane === "openrouter") return "OpenRouter";
  if (lane === "huggingface") return "Hugging Face";
  if (lane === "apple") return "Apple Intelligence";
  return "Cloud";
}

class ModelOverrideClient implements ChatRuntimeClient {
  constructor(
    private readonly inner: ChatRuntimeClient,
    private readonly model: string,
  ) {}

  createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options?: Parameters<ChatRuntimeClient["createChatCompletion"]>[2],
  ): Promise<ChatCompletionResponse> {
    return this.inner.createChatCompletion(surface, {
      ...request,
      model: request.model ?? this.model,
    }, options);
  }
}

class RuntimeRouteTagClient implements ChatRuntimeClient {
  constructor(
    private readonly inner: ChatRuntimeClient,
    private readonly route: {
      using: string;
      provider?: string;
      model?: string;
      routerIntent: string | null;
      routerReason: string | null;
      routerMode: string | null;
    },
  ) {}

  async createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options?: Parameters<ChatRuntimeClient["createChatCompletion"]>[2],
  ): Promise<ChatCompletionResponse> {
    const response = await this.inner.createChatCompletion(surface, request, options);
    response.meta = {
      ...response.meta,
      provider: response.meta?.provider ?? this.route.provider,
      model: response.meta?.model ?? this.route.model,
      using: response.meta?.using ?? this.route.using,
      router_intent: response.meta?.router_intent ?? this.route.routerIntent ?? undefined,
      router_reason: response.meta?.router_reason ?? this.route.routerReason ?? undefined,
      router_mode: response.meta?.router_mode ?? this.route.routerMode ?? undefined,
    };
    return response;
  }
}

class OpenRouterRateLimitClient implements ChatRuntimeClient {
  constructor(private readonly inner: ChatRuntimeClient) {}

  async createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options?: Parameters<ChatRuntimeClient["createChatCompletion"]>[2],
  ): Promise<ChatCompletionResponse> {
    recordOpenRouterRequest(); // throws if either limit is exceeded
    return this.inner.createChatCompletion(surface, request, options);
  }
}
