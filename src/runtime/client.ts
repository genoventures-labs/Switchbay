import { getRuntimeLane, type CloudProvider, type RuntimeLane } from "../config/env";
import { AnthropicClient } from "./anthropic-client";
import { CloudRouterClient } from "./cloud-router-client";
import { LmStudioClient } from "./lmstudio-client";
import { LmStudioMcpClient } from "./lmstudio-mcp-client";
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
  provider?: Exclude<CloudProvider, "auto"> | null;
};

export function createRuntimeClient(
  lane: RuntimeLane = getRuntimeLane(),
  options: RuntimeClientOptions = {},
): ChatRuntimeClient {
  const model = options.model?.trim() || undefined;
  let client: ChatRuntimeClient;
  if (lane === "local") {
    client = new LmStudioClient();
  } else if (lane === "local-mcp") {
    client = new LmStudioMcpClient();
  } else if (options.provider === "openai") {
    client = new OpenAiClient();
  } else if (options.provider === "anthropic") {
    client = new AnthropicClient();
  } else {
    client = new CloudRouterClient();
  }

  return model ? new ModelOverrideClient(client, model) : client;
}

export function getRuntimeLaneLabel(lane: RuntimeLane = getRuntimeLane()): string {
  if (lane === "cloud-mcp") return "Cloud MCP";
  if (lane === "local") return "LM Studio";
  if (lane === "local-mcp") return "LM Studio MCP";
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
