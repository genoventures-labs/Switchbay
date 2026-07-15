export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string | unknown;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Provider-native assistant content retained for faithful continuation. */
  provider_content?: unknown;
};

export type ProviderName = "anthropic" | "openai" | "google";

export type ProviderToolEvent = {
  provider: ProviderName;
  type: string;
  server_managed: true;
  id?: string;
  name?: string;
  status?: "started" | "completed" | "failed" | "paused";
  input?: unknown;
  output?: unknown;
};

export type ProviderCitation = {
  provider: ProviderName;
  url?: string;
  title?: string;
  start?: number;
  end?: number;
};

export type ProviderArtifact = {
  provider: ProviderName;
  id?: string;
  name?: string;
  mime_type?: string;
  container_id?: string;
  file_id?: string;
};

export type ProviderContinuation = {
  provider: ProviderName;
  kind: string;
  id?: string;
  state?: unknown;
};

export type ProviderEnvelope = {
  events: ProviderToolEvent[];
  citations: ProviderCitation[];
  artifacts: ProviderArtifact[];
  continuation?: ProviderContinuation;
};

export type ToolFunction = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type ToolDefinition = {
  type: "function";
  function: ToolFunction;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  profile?: string;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
};

export type ChatCompletionChoice = {
  message?: ChatMessage & { tool_calls?: ToolCall[] };
  finish_reason?: "stop" | "tool_calls" | string;
};

export type ChatCompletionResponse = {
  id?: string;
  object?: string;
  choices?: ChatCompletionChoice[];
  output_text?: string;
  _rawText?: string;
  provider?: ProviderEnvelope;
  meta?: {
    provider?: string;
    model?: string;
    router_intent?: string;
    router_reason?: string;
    router_mode?: string;
    using?: string;
    done_reason?: string;
    sass_factor?: number;
  };
};

export type RuntimeEnvironmentHeaders = {
  os: string;
  project: string;
  pwd: string;
  shell: string;
};

export type WorkspaceFocus = {
  cwd: string;
  repoRoot?: string | null;
  branch?: string | null;
  project?: string;
};
