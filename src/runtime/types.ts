export type OriRole = "system" | "user" | "assistant" | "tool";

export type OriMessage = {
  role: OriRole;
  content: string;
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
  model: string;
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
  meta?: {
    provider?: string;
    sass_factor?: number;
    scratchpad?: ScratchpadState;
  };
};

export type ScratchpadStatus = "active" | "stale";

export type ScratchpadState = {
  status: ScratchpadStatus;
  task?: string;
  surface?: string;
  profile?: string;
};

export type FeedbackRequest = {
  prompt: string;
  response: string;
  sass?: number;
  roast?: string;
  lesson?: string;
};

export type OriCapabilityName =
  | "memory_lookup"
  | "plan_review"
  | "repo_research"
  | "web_search"
  | "web_fetch"
  | "research"
  | "repo_report"
  | "ask_ori";

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

export type CapabilityRequest = {
  input: Record<string, unknown>;
  sessionId?: string;
  surface: string;
  workspace?: WorkspaceFocus;
};

export type CapabilityResponse = {
  ok?: boolean;
  result?: unknown;
  output?: unknown;
  data?: unknown;
};

export type SessionSummary = {
  id: string;
  created?: string;
  updated?: string;
  title?: string;
};

export type SessionMessage = {
  id?: string;
  role?: string;
  content?: string;
  created?: string;
};

export type RuntimeHealth = {
  status?: string;
  system?: string;
};

export type ModelInfo = {
  id?: string;
  object?: string;
  [key: string]: unknown;
};

export type ToolInfo = {
  name?: string;
  description?: string;
  [key: string]: unknown;
};

export type BrowserHealth = {
  status?: string;
  healthy?: boolean;
  [key: string]: unknown;
};

export type DaemonHealth = Record<string, unknown>;

export type SpaceInfo = {
  id?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
};
