export type OriRole = "system" | "user" | "assistant" | "tool";

export type OriMessage = {
  role: OriRole;
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
  messages: OriMessage[];
  profile?: string;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
};

export type ChatCompletionChoice = {
  message?: OriMessage & { tool_calls?: ToolCall[] };
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
