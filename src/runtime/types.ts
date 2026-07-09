export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string | unknown;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
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
  meta?: {
    provider?: string;
    model?: string;
    router_intent?: string;
    router_reason?: string;
    router_mode?: string;
    using?: string;
    done_reason?: string;
    lmstudio_tool_calls?: string[];
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
