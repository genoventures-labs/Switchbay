import { DEFAULTS } from "../config/defaults";
import path from "node:path";
import {
  getApiBase,
  getApiKey,
  getDebugEmptyResponses,
  getDefaultModel,
  getRuntimeEnvironmentHeaders,
} from "../config/env";
import type {
  CapabilityRequest,
  CapabilityResponse,
  BrowserHealth,
  ChatCompletionRequest,
  ChatCompletionResponse,
  DaemonHealth,
  FeedbackRequest,
  ModelInfo,
  OriCapabilityName,
  RuntimeEnvironmentHeaders,
  SessionMessage,
  SessionSummary,
  SpaceInfo,
  RuntimeHealth,
  ToolInfo,
  WorkspaceFocus,
} from "./types";

type OriClientOptions = {
  apiBase?: string;
  apiKey?: string;
  environment?: RuntimeEnvironmentHeaders;
  fetchImpl?: typeof fetch;
};

export class OriClient {
  private readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly staticEnvironment: RuntimeEnvironmentHeaders | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OriClientOptions = {}) {
    this.apiBase = options.apiBase ?? getApiBase();
    this.apiKey = options.apiKey ?? getApiKey();
    // Only store a static snapshot if explicitly provided — otherwise resolve live
    // from process.cwd() on every request so /hop workspace changes are reflected.
    this.staticEnvironment = options.environment;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get environment(): RuntimeEnvironmentHeaders {
    return this.staticEnvironment ?? getRuntimeEnvironmentHeaders();
  }

  async createChatCompletion(
    surface: string,
    request: ChatCompletionRequest,
    options: {
      sessionId?: string;
      operator?: boolean;
      sendEnv?: boolean;
      workspace?: WorkspaceFocus;
    } = {},
  ): Promise<ChatCompletionResponse> {
    const response = await this.fetchImpl(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.buildHeaders(surface, options.sessionId, {
          operator: options.operator,
          sendEnv: options.sendEnv,
          workspace: options.workspace,
        }),
        "X-ORI-Include-Scratchpad": "true",
      },
      body: JSON.stringify({
        model: request.model ?? getDefaultModel(),
        messages: request.messages,
        profile: request.profile,
        stream: request.stream ?? false,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.tool_choice !== undefined ? { tool_choice: request.tool_choice } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `ORI API error: ${response.status}${body ? ` - ${body}` : ""}`,
      );
    }

    const rawText = await response.text();
    const parsed = JSON.parse(rawText) as ChatCompletionResponse;
    parsed._rawText = rawText;

    if (getDebugEmptyResponses()) {
      const hasStringContent =
        typeof parsed.choices?.[0]?.message?.content === "string" &&
        parsed.choices?.[0]?.message?.content.trim().length > 0;
      const hasOutputText =
        typeof parsed.output_text === "string" && parsed.output_text.trim().length > 0;
      if (!hasStringContent && !hasOutputText) {
        console.error("[ori-code] empty-looking chat completion response:");
        console.error(rawText);
      }
    }

    return parsed;
  }

  async submitFeedback(feedback: FeedbackRequest): Promise<void> {
    const response = await this.fetchImpl(`${this.apiBase}/chat/feedback`, {
      method: "POST",
      headers: this.buildHeaders(DEFAULTS.surface),
      body: JSON.stringify(feedback),
    });

    if (!response.ok) {
      throw new Error(`ORI feedback error: ${response.status}`);
    }
  }

  async getHealth(): Promise<RuntimeHealth> {
    return (await this.getJson("/health", DEFAULTS.surface)) as RuntimeHealth;
  }

  async listModels(surface?: string): Promise<ModelInfo[]> {
    const response = await this.getJson("/models", surface ?? DEFAULTS.surface);
    return Array.isArray((response as { data?: unknown })?.data)
      ? (((response as { data?: unknown }).data ?? []) as ModelInfo[])
      : [];
  }

  async listTools(surface?: string): Promise<ToolInfo[]> {
    const response = await this.getJson("/tools", surface ?? DEFAULTS.surface);
    if (Array.isArray(response)) {
      return response as ToolInfo[];
    }
    if (Array.isArray((response as { tools?: unknown })?.tools)) {
      return (((response as { tools?: unknown }).tools ?? []) as ToolInfo[]);
    }
    return [];
  }

  async getBrowserHealth(surface?: string): Promise<BrowserHealth> {
    return (await this.getJson("/browser/health", surface ?? DEFAULTS.surface)) as BrowserHealth;
  }

  async getDaemons(surface?: string): Promise<DaemonHealth> {
    return (await this.getJson("/daemons", surface ?? DEFAULTS.surface)) as DaemonHealth;
  }

  async invokeMCPTool(
    toolName: string,
    args: Record<string, unknown> = {},
    surface = DEFAULTS.surface,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}/mcp`, {
      method: "POST",
      headers: {
        ...this.buildHeaders(surface),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ORI MCP error: ${response.status}${text ? ` - ${text}` : ""}`);
    }

    const data = (await response.json()) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(data.error.message ?? "MCP error");
    }

    const text = data.result?.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async listSpaces(surface?: string): Promise<SpaceInfo[]> {
    const response = await this.getJson("/spaces", surface ?? DEFAULTS.surface);
    if (Array.isArray(response)) {
      return response as SpaceInfo[];
    }
    if (Array.isArray((response as { spaces?: unknown })?.spaces)) {
      return (((response as { spaces?: unknown }).spaces ?? []) as SpaceInfo[]);
    }
    return [];
  }

  async invokeCapability(input: {
    capability: OriCapabilityName;
    profile?: string;
    prompt: string;
    sessionId?: string;
    surface: string;
    workspace?: WorkspaceFocus;
    workspaceContext?: string;
  }): Promise<string> {
    const mappedEndpoint = mapCapabilityEndpoint(input.capability);

    if (mappedEndpoint) {
      const response = await this.postCapability(mappedEndpoint, {
        input: buildCapabilityInput(
          input.capability,
          input.prompt,
          input.surface,
          input.profile,
          input.workspaceContext,
        ),
        sessionId: input.sessionId,
        surface: input.surface,
        workspace: input.workspace,
      });

      return stringifyCapabilityResponse(response);
    }

    const capabilityInstruction = getCapabilityInstruction(input.capability);
    const response = await this.createChatCompletion(input.surface, {
      model: getDefaultModel(),
      profile: input.profile,
      stream: false,
      messages: [
        {
          role: "system",
          content: capabilityInstruction,
        },
        {
          role: "user",
          content: input.prompt,
        },
      ],
    }, { sessionId: input.sessionId, workspace: input.workspace });

    return response.choices?.[0]?.message?.content ?? "";
  }

  async sendEmail(input: {
    body: string;
    subject: string;
    to: string | string[];
    surface?: string;
    sessionId?: string;
  }) {
    return this.postJson("/email/send", {
      to: input.to,
      subject: input.subject,
      body: input.body,
    }, input.surface ?? DEFAULTS.surface, input.sessionId);
  }

  async postCapability(
    endpoint: "agent" | "research" | "web-search" | "web-fetch" | "repo-report",
    request: CapabilityRequest,
  ): Promise<CapabilityResponse> {
    const response = await this.postJson(
      `/capabilities/${endpoint}`,
      request.input,
      request.surface,
      request.sessionId,
      { sendEnv: true, workspace: request.workspace },
    );

    return response as CapabilityResponse;
  }

  async listSessions(input: {
    limit?: number;
    surface: string;
  }): Promise<SessionSummary[]> {
    const params = new URLSearchParams({
      surface: input.surface,
      ...(input.limit ? { limit: String(input.limit) } : {}),
    });
    const response = await this.getJson(`/sessions?${params.toString()}`, input.surface);
    return Array.isArray(response) ? (response as SessionSummary[]) : [];
  }

  async getSessionMessages(input: {
    id: string;
    limit?: number;
    surface: string;
  }): Promise<SessionMessage[]> {
    const params = new URLSearchParams(
      input.limit ? { limit: String(input.limit) } : {},
    );
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const response = await this.getJson(`/sessions/${input.id}/messages${suffix}`, input.surface);
    return Array.isArray(response) ? (response as SessionMessage[]) : [];
  }

  private async postJson(
    path: string,
    body: unknown,
    surface: string,
    sessionId?: string,
    options: { sendEnv?: boolean; workspace?: WorkspaceFocus } = {},
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: "POST",
      headers: this.buildHeaders(surface, sessionId, {
        sendEnv: options.sendEnv,
        workspace: options.workspace,
      }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ORI API error: ${response.status}${text ? ` - ${text}` : ""}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  private async getJson(path: string, surface: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: "GET",
      headers: this.buildHeaders(surface),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ORI API error: ${response.status}${text ? ` - ${text}` : ""}`);
    }

    return response.json();
  }

  private buildHeaders(
    surface: string,
    sessionId?: string,
    options: {
      operator?: boolean;
      sendEnv?: boolean;
      workspace?: WorkspaceFocus;
    } = {},
  ): Record<string, string> {
    if (!this.apiKey) {
      throw new Error("Missing ORI_API_KEY");
    }

    const workspace = resolveWorkspaceFocus(this.environment, options.workspace);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-Ori-Context": surface,
      "X-Ori-Surface": surface,
      "X-Ori-Focus": "workspace",
      "X-Ori-Workspace-Cwd": workspace.cwd,
      "X-Ori-Workspace-Project": workspace.project,
    };

    if (workspace.repoRoot) {
      headers["X-Ori-Workspace-Root"] = workspace.repoRoot;
      headers["X-Ori-Workspace-Repo"] = path.basename(workspace.repoRoot);
    }

    if (workspace.branch) {
      headers["X-Ori-Workspace-Branch"] = workspace.branch;
    }

    // Only send broader host environment details on user-initiated turns.
    // Workspace focus headers are always sent so the runtime can stay scoped.
    if (options.sendEnv) {
      headers["X-Env-OS"] = this.environment.os;
      headers["X-Env-PWD"] = this.environment.pwd;
      headers["X-Env-Project"] = this.environment.project;
      headers["X-Env-Shell"] = this.environment.shell;
    }

    if (sessionId) {
      headers["X-Session-ID"] = sessionId;
    }

    if (options.operator) {
      headers["X-ORI-Operator"] = "ori-code";
    }

    return headers;
  }
}

function resolveWorkspaceFocus(
  environment: RuntimeEnvironmentHeaders,
  workspace?: WorkspaceFocus,
): Required<Pick<WorkspaceFocus, "cwd" | "project">> &
  Pick<WorkspaceFocus, "repoRoot" | "branch"> {
  const cwd = workspace?.cwd ?? environment.pwd;
  const repoRoot = workspace?.repoRoot ?? null;
  const branch = workspace?.branch ?? null;
  const project =
    workspace?.project ??
    path.basename(repoRoot || cwd || environment.project || environment.pwd);

  return {
    cwd,
    repoRoot,
    branch,
    project,
  };
}

function getCapabilityInstruction(capability: OriCapabilityName): string {
  switch (capability) {
    case "memory_lookup":
      return "Act as ORI's memory lookup helper. Return concise recalled context, prior constraints, and likely continuity hints only.";
    case "plan_review":
      return "Act as ORI's planning reviewer. Return a concise critique of the plan, risks, and recommended next moves.";
    case "repo_research":
      return "Act as ORI's repo research helper. Synthesize the provided repository context into practical findings and next questions.";
    case "web_search":
      return "Act as ORI's web search helper. Return concise search findings with practical relevance.";
    case "web_fetch":
      return "Act as ORI's web fetch helper. Return cleaned, concise content from the provided URL.";
    case "research":
      return "Act as ORI's deep research helper. Return a concise synthesis with strongest findings first.";
    case "repo_report":
      return "Act as ORI's repository report helper. Produce a compact, high-signal repo snapshot.";
    case "ask_ori":
      return "Act as ORI's internal ask_ori helper. Answer directly and concisely.";
    default:
      return "Act as an ORI internal capability helper and answer concisely.";
  }
}

function mapCapabilityEndpoint(
  capability: OriCapabilityName,
): "agent" | "research" | "web-search" | "web-fetch" | "repo-report" | null {
  switch (capability) {
    case "ask_ori":
    case "memory_lookup":
    case "plan_review":
    case "repo_research":
      return "agent";
    case "research":
      return "research";
    case "web_search":
      return "web-search";
    case "web_fetch":
      return "web-fetch";
    case "repo_report":
      return "repo-report";
    default:
      return null;
  }
}

function buildCapabilityInput(
  capability: OriCapabilityName,
  prompt: string,
  surface: string,
  profile?: string,
  workspaceContext?: string,
): Record<string, unknown> {
  const promptWithWorkspace = workspaceContext
    ? [
        "Current workspace context:",
        workspaceContext,
        "",
        "User request:",
        prompt,
      ].join("\n")
    : prompt;

  switch (capability) {
    case "web_fetch":
      return { url: prompt };
    case "repo_report":
      return {
        prompt: promptWithWorkspace,
        surface,
        profile,
        workspace_context: workspaceContext,
      };
    case "repo_research":
      return {
        prompt: promptWithWorkspace,
        question: promptWithWorkspace,
        surface,
        profile,
        workspace_context: workspaceContext,
      };
    case "research":
    case "web_search":
      return { prompt, query: prompt, surface, profile };
    default:
      return { prompt, question: prompt, surface, profile };
  }
}

function stringifyCapabilityResponse(response: CapabilityResponse): string {
  const value = response.result ?? response.output ?? response.data ?? response;
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
