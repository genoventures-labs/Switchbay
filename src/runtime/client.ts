import { getRuntimeLane, type RuntimeLane } from "../config/env";
import { AnthropicClient } from "./anthropic-client";
import { CloudRouterClient } from "./cloud-router-client";
import { getCloudProviderConfig, type CloudProviderId } from "./cloud-providers";
import { getActiveLocalProvider, getLocalProviderConfig, type LocalProviderId } from "./local-providers";
import { OllamaClient } from "./ollama-client";
import { OpenAiClient } from "./openai-client";
import type { ChatCompletionRequest, ChatCompletionResponse, WorkspaceFocus } from "./types";

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
};

export function createRuntimeClient(
  lane: RuntimeLane = getRuntimeLane(),
  options: RuntimeClientOptions = {},
): ChatRuntimeClient {
  const model = options.model?.trim() || undefined;
  let client: ChatRuntimeClient;
  let using: string | null = null;
  let routerIntent: string | null = null;
  let routerReason: string | null = null;
  let routerMode: string | null = null;
  if (lane === "local") {
    const localProvider = options.localProvider ?? getActiveLocalProvider();
    client = new OllamaClient();
    const config = getLocalProviderConfig(localProvider);
    using = `local/ollama/${model ?? config.model ?? "default"}`;
    routerIntent = "local_provider";
    routerReason = `Local provider selected: Ollama.`;
    routerMode = options.localProvider ? "explicit" : "configured";
  } else if (options.provider === "openai") {
    client = new OpenAiClient();
    const config = getCloudProviderConfig("openai");
    using = `cloud/openai/${model ?? config.model}`;
    routerIntent = "explicit_provider";
    routerReason = `Explicit cloud provider selected: ${config.label}.`;
    routerMode = "explicit";
  } else if (options.provider === "anthropic") {
    client = new AnthropicClient();
    const config = getCloudProviderConfig("anthropic");
    using = `cloud/anthropic/${model ?? config.model}`;
    routerIntent = "explicit_provider";
    routerReason = `Explicit cloud provider selected: ${config.label}.`;
    routerMode = "explicit";
  } else if (options.provider === "google") {
    client = new OpenAiClient({ provider: "google" });
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
    ? new RuntimeRouteTagClient(withModel, { using, routerIntent, routerReason, routerMode })
    : withModel;
}

export function getRuntimeLaneLabel(lane: RuntimeLane = getRuntimeLane()): string {
  if (lane === "cloud-mcp") return "Cloud + MCP Bridge";
  if (lane === "local") return "Ollama";
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
      using: response.meta?.using ?? this.route.using,
      router_intent: response.meta?.router_intent ?? this.route.routerIntent ?? undefined,
      router_reason: response.meta?.router_reason ?? this.route.routerReason ?? undefined,
      router_mode: response.meta?.router_mode ?? this.route.routerMode ?? undefined,
    };
    return response;
  }
}
