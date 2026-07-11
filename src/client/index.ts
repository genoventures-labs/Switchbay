export type SwitchbayOptions = {
  baseUrl?: string;
  token?: string;
  clientId?: string;
  workspace?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

export type TurnInput = {
  input: string;
  workspace?: string;
  clientId?: string;
  lane?: string;
  mode?: string;
  profile?: string;
  surface?: string;
  sessionId?: string;
  newSession?: boolean;
  signal?: AbortSignal;
};

export type TurnResult = {
  requestId: string;
  sessionId: string;
  content: string;
  lane: string;
  traceSaved: boolean;
  toolExecutions: Array<{ tool: string; summary: string; ok: boolean; changedFile?: string }>;
  workspace: { cwd: string; repoRoot: string | null; branch: string | null; dirtyFiles: string[] };
  pendingApproval?: { id: string; kind: string; title: string; summary: string; commandHint: string; createdAt: number } | null;
  route?: { provider?: string; model?: string; using?: string } | null;
};
export type StreamEvent = { event: "request" | "token" | "step" | "done" | "error"; data: any };

export class SwitchbayError extends Error {
  constructor(message: string, public status: number, public code: string, public details?: unknown) { super(message); this.name = "SwitchbayError"; }
}

export class Switchbay {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly workspace?: string;
  private readonly token?: string;
  private readonly fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

  constructor(options: SwitchbayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:7349").replace(/\/$/, "");
    this.clientId = options.clientId ?? "default";
    this.workspace = options.workspace;
    this.token = options.token?.trim();
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error("Switchbay requires a global fetch implementation");
  }

  health(signal?: AbortSignal) { return this.request("/health", { signal }); }
  status(signal?: AbortSignal) { return this.request("/v1/status", { signal }); }
  capabilities(signal?: AbortSignal) { return this.request("/v1/capabilities", { signal }); }
  turn(input: TurnInput): Promise<TurnResult> {
    const { signal, ...body } = input;
    return this.request("/v1/turn", { method: "POST", signal, body: { clientId: this.clientId, workspace: this.workspace, ...body } }) as Promise<TurnResult>;
  }
  async *turnStream(input: TurnInput): AsyncGenerator<StreamEvent> {
    const { signal, ...body } = input;
    const headers: Record<string, string> = { accept: "text/event-stream", "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetcher(`${this.baseUrl}/v1/turn/stream`, { method: "POST", headers, body: JSON.stringify({ clientId: this.clientId, workspace: this.workspace, ...body }), signal });
    if (!response.ok || !response.body) { const data: any = await response.json().catch(() => null); throw new SwitchbayError(data?.error?.message ?? `Switchbay stream failed (${response.status})`, response.status, data?.error?.code ?? "request_failed", data); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = block.match(/^event: (.+)$/m)?.[1] as StreamEvent["event"] | undefined;
        const raw = block.match(/^data: (.+)$/m)?.[1];
        if (event && raw) yield { event, data: JSON.parse(raw) };
      }
      if (done) break;
    }
  }
  sessions = { list: (signal?: AbortSignal) => this.request(`/v1/sessions?${this.query()}`, { signal }) };
  memory = {
    get: (signal?: AbortSignal) => this.request(`/v1/memory?${this.query()}`, { signal }),
    refresh: (signal?: AbortSignal) => this.request("/v1/memory/refresh", { method: "POST", signal, body: { workspace: this.workspace } }),
  };
  knowledge = {
    get: (signal?: AbortSignal) => this.request(`/v1/knowledge?${this.query()}`, { signal }),
    refresh: (signal?: AbortSignal) => this.request("/v1/knowledge/refresh", { method: "POST", signal, body: { workspace: this.workspace } }),
    search: (q: string, signal?: AbortSignal) => this.request(`/v1/knowledge/search?${this.query({ q })}`, { signal }),
  };
  traces = { latest: (signal?: AbortSignal) => this.request(`/v1/trace/latest?${this.query()}`, { signal }) };
  approvals = {
    get: (sessionId: string, signal?: AbortSignal) => this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/approval`, { signal }),
    approve: (sessionId: string, approvalId: string, signal?: AbortSignal) => this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/approval/approve`, { method: "POST", signal, body: { approvalId } }),
    cancel: (sessionId: string, approvalId: string, signal?: AbortSignal) => this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/approval/cancel`, { method: "POST", signal, body: { approvalId } }),
  };
  cancel(requestId: string, signal?: AbortSignal) { return this.request(`/v1/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", signal, body: {} }); }

  private query(extra: Record<string, string> = {}) { const p = new URLSearchParams(extra); if (this.workspace) p.set("workspace", this.workspace); p.set("clientId", this.clientId); return p.toString(); }
  private async request(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<any> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetcher(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
    const data: any = await response.json().catch(() => null);
    if (!response.ok) throw new SwitchbayError(data?.error?.message ?? `Switchbay request failed (${response.status})`, response.status, data?.error?.code ?? "request_failed", data);
    return data;
  }
}
