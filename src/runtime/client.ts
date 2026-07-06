import { getRuntimeLane, type RuntimeLane } from "../config/env";
import { CloudRouterClient } from "./cloud-router-client";
import { LmStudioClient } from "./lmstudio-client";
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

export function createRuntimeClient(lane: RuntimeLane = getRuntimeLane()): ChatRuntimeClient {
  if (lane === "local") {
    return new LmStudioClient();
  }
  return new CloudRouterClient();
}

export function getRuntimeLaneLabel(lane: RuntimeLane = getRuntimeLane()): string {
  return lane === "local" ? "LM Studio" : "Cloud";
}
