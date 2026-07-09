import {
  getAnthropicModel,
  getLmStudioApiKey,
  getLmStudioBase,
  getLmStudioNativeBase,
  getOpenAiModel,
  type CloudProvider,
  type RuntimeLane,
} from "../config/env";
import { getActiveLocalProvider, getLocalProviderConfig } from "./local-providers";

export type RuntimeModelProvider = Exclude<CloudProvider, "auto"> | "lmstudio" | "lmstudio-mcp" | "ollama";

export type RuntimeModelOption = {
  id: string;
  label: string;
  lane: RuntimeLane;
  provider: RuntimeModelProvider;
  source: "preset" | "env" | "lmstudio" | "ollama";
};

export type RuntimeModelList = {
  models: RuntimeModelOption[];
  notice?: string;
};

export type LmStudioPullOptions = {
  model: string;
  quantization?: string | null;
  fetchImpl?: FetchLike;
  pollDelayMs?: number;
  maxPolls?: number;
};

export type LmStudioPullResult = {
  model: string;
  downloadStatus: string;
  jobId?: string;
  loadStatus: string;
  instanceId?: string;
  loadTimeSeconds?: number;
};

const OPENAI_PRESETS: RuntimeModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5", lane: "cloud", provider: "openai", source: "preset" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", lane: "cloud", provider: "openai", source: "preset" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", lane: "cloud", provider: "openai", source: "preset" },
];

const ANTHROPIC_PRESETS: RuntimeModelOption[] = [
  { id: "claude-opus-4-1", label: "Claude Opus 4.1", lane: "cloud", provider: "anthropic", source: "preset" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", lane: "cloud", provider: "anthropic", source: "preset" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", lane: "cloud", provider: "anthropic", source: "preset" },
];

type LmStudioModelsResponse = {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
};

type LmStudioNativeModelsResponse = {
  models?: Array<{
    key?: string;
    display_name?: string;
    loaded_instances?: unknown[];
  }>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function getCloudModelPresets(): RuntimeModelOption[] {
  return getCloudModelPresetsForLane("cloud");
}

export function getCloudModelPresetsForLane(lane: Extract<RuntimeLane, "cloud" | "cloud-mcp">): RuntimeModelOption[] {
  return uniqueModels([
    envModelOption(getOpenAiModel(), "OpenAI env default", lane, "openai"),
    envModelOption(getAnthropicModel(), "Anthropic env default", lane, "anthropic"),
    ...OPENAI_PRESETS.map((model) => ({ ...model, lane })),
    ...ANTHROPIC_PRESETS.map((model) => ({ ...model, lane })),
  ]);
}

export async function listRuntimeModels(lane: RuntimeLane, localProvider = getActiveLocalProvider()): Promise<RuntimeModelList> {
  if (lane === "cloud" || lane === "cloud-mcp") {
    return { models: getCloudModelPresetsForLane(lane) };
  }

  if (lane === "local" && localProvider === "ollama") {
    return listOllamaModels();
  }

  return listLmStudioModels(undefined, lane);
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
};

export async function listOllamaModels(fetchImpl: FetchLike = fetch): Promise<RuntimeModelList> {
  const config = getLocalProviderConfig("ollama");
  try {
    const response = await fetchImpl(`${config.apiBase}/tags`);
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return { models: [], notice: `Ollama model fetch returned ${response.status}: ${body.trim() || response.statusText}` };
    }
    const parsed = JSON.parse(body) as OllamaTagsResponse;
    const models: RuntimeModelOption[] = (parsed.models ?? [])
      .flatMap((model) => {
        const id = (model.model ?? model.name ?? "").trim();
        if (!id) return [];
        const details = [
          model.details?.parameter_size,
          model.details?.quantization_level,
        ].filter(Boolean).join(" ");
        return [{
          id,
          label: details ? `${id} (${details})` : id,
          lane: "local" as const,
          provider: "ollama" as const,
          source: "ollama" as const,
        }];
      });
    return {
      models: uniqueModels(models),
      notice: models.length ? undefined : `Ollama returned no models from ${config.apiBase}/tags. Pull one with \`switchbay model pull ollama <model>\`.`,
    };
  } catch (error: any) {
    return { models: [], notice: `Could not reach Ollama at ${config.apiBase}: ${error.message}` };
  }
}

export async function listLmStudioModels(
  fetchImpl: FetchLike = fetch,
  lane: Extract<RuntimeLane, "local" | "local-mcp"> = "local",
): Promise<RuntimeModelList> {
  const provider: RuntimeModelProvider = lane === "local-mcp" ? "lmstudio-mcp" : "lmstudio";
  const apiBase = getLocalProviderConfig("lmstudio").apiBase || getLmStudioBase();
  const nativeBase = getLmStudioNativeBase();
  const headers: Record<string, string> = {};
  const apiKey = getLmStudioApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const nativeResult = await listLmStudioNativeModels(nativeBase, lane, provider, headers, fetchImpl);
    if (nativeResult.models.length > 0 || nativeResult.notice) {
      return nativeResult;
    }

    const response = await fetchImpl(`${apiBase}/models`, { headers });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        models: [],
        notice: formatLmStudioModelFetchError(apiBase, response.status, body, Boolean(apiKey)),
      };
    }

    let parsed: LmStudioModelsResponse;
    try {
      parsed = JSON.parse(body) as LmStudioModelsResponse;
    } catch {
      return {
        models: [],
        notice: formatLmStudioModelFetchError(apiBase, response.status, body, Boolean(apiKey)),
      };
    }

    const models = (parsed.data ?? [])
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        id,
        label: id,
        lane,
        provider,
        source: "lmstudio" as const,
      }));

    return {
      models: uniqueModels(models),
      notice: models.length === 0
        ? `LM Studio returned no models from ${nativeBase}/models or ${apiBase}/models. Load a model in LM Studio, then reopen /model.`
        : undefined,
    };
  } catch (error: any) {
    return {
      models: [],
      notice: `Could not reach LM Studio at ${apiBase}: ${error.message}`,
    };
  }
}

export async function pullLmStudioModel(options: LmStudioPullOptions): Promise<LmStudioPullResult> {
  const model = options.model.trim();
  if (!model) throw new Error("LM Studio model id or Hugging Face URL is required.");

  const fetchImpl = options.fetchImpl ?? fetch;
  const nativeBase = getLmStudioNativeBase();
  const headers = lmStudioJsonHeaders();
  const downloadPayload: Record<string, unknown> = { model };
  const quantization = options.quantization?.trim();
  if (quantization) downloadPayload.quantization = quantization;

  const started = await postLmStudioJson(`${nativeBase}/models/download`, downloadPayload, headers, fetchImpl);
  const jobId = typeof started.job_id === "string" ? started.job_id : undefined;
  let downloadStatus = String(started.status ?? "unknown");

  if (jobId && (downloadStatus === "downloading" || downloadStatus === "paused")) {
    const maxPolls = options.maxPolls ?? 180;
    const pollDelayMs = options.pollDelayMs ?? 2000;
    for (let i = 0; i < maxPolls; i++) {
      if (pollDelayMs > 0) await Bun.sleep(pollDelayMs);
      const status = await getLmStudioJson(`${nativeBase}/models/download/status/${encodeURIComponent(jobId)}`, headers, fetchImpl);
      downloadStatus = String(status.status ?? downloadStatus);
      if (downloadStatus === "completed" || downloadStatus === "failed") break;
    }
  }

  if (downloadStatus !== "completed" && downloadStatus !== "already_downloaded") {
    throw new Error(`LM Studio download did not complete. Status: ${downloadStatus}${jobId ? ` (${jobId})` : ""}.`);
  }

  const loaded = await postLmStudioJson(`${nativeBase}/models/load`, {
    model,
    echo_load_config: true,
  }, headers, fetchImpl);

  return {
    model,
    downloadStatus,
    jobId,
    loadStatus: String(loaded.status ?? "unknown"),
    instanceId: typeof loaded.instance_id === "string" ? loaded.instance_id : undefined,
    loadTimeSeconds: typeof loaded.load_time_seconds === "number" ? loaded.load_time_seconds : undefined,
  };
}

export async function pullOllamaModel(options: { model: string; fetchImpl?: FetchLike }): Promise<{ model: string; status: string }> {
  const model = options.model.trim();
  if (!model) throw new Error("Ollama model name is required.");
  const config = getLocalProviderConfig("ollama");
  const response = await (options.fetchImpl ?? fetch)(`${config.apiBase}/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false }),
  });
  const body = await response.text().catch(() => "");
  let status = "";
  try {
    status = String((JSON.parse(body) as { status?: string }).status ?? "");
  } catch {
    status = body.trim();
  }
  if (!response.ok) {
    throw new Error(`Ollama API error ${response.status}: ${status || response.statusText}`);
  }
  return { model, status: status || "success" };
}

async function listLmStudioNativeModels(
  nativeBase: string,
  lane: Extract<RuntimeLane, "local" | "local-mcp">,
  provider: RuntimeModelProvider,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<RuntimeModelList> {
  try {
    const response = await fetchImpl(`${nativeBase}/models`, { headers });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return { models: [], notice: formatLmStudioModelFetchError(nativeBase, response.status, body, Boolean(headers.Authorization)) };
    }

    let parsed: LmStudioNativeModelsResponse;
    try {
      parsed = JSON.parse(body) as LmStudioNativeModelsResponse;
    } catch {
      return { models: [], notice: undefined };
    }

    const models = (parsed.models ?? [])
      .map((model) => ({
        id: model.key?.trim() ?? "",
        label: model.display_name?.trim() || model.key?.trim() || "",
      }))
      .filter((model): model is { id: string; label: string } => Boolean(model.id))
      .map((model) => ({
        id: model.id,
        label: model.label,
        lane,
        provider,
        source: "lmstudio" as const,
      }));

    return { models: uniqueModels(models) };
  } catch {
    return { models: [] };
  }
}

function formatLmStudioModelFetchError(
  apiBase: string,
  status: number,
  body: string,
  hasApiKey: boolean,
): string {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();
  const authLike =
    status === 401 ||
    status === 403 ||
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("bearer");

  if (authLike || !hasApiKey) {
    return [
      `LM Studio needs an API key for ${apiBase}/models.`,
      "Generate one in LM Studio and set SWITCHBAY_LMSTUDIO_API_KEY.",
      trimmed ? `Server said: ${trimmed.slice(0, 120)}` : "",
    ].filter(Boolean).join(" ");
  }

  return [
    `LM Studio model fetch returned ${status}, but not JSON.`,
    trimmed ? `Server said: ${trimmed.slice(0, 120)}` : "",
  ].filter(Boolean).join(" ");
}

function lmStudioJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getLmStudioApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function postLmStudioJson(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseLmStudioJsonResponse(url, response);
}

async function getLmStudioJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { headers });
  return parseLmStudioJsonResponse(url, response);
}

async function parseLmStudioJsonResponse(url: string, response: Response): Promise<Record<string, unknown>> {
  const body = await response.text().catch(() => "");
  let parsed: unknown = {};
  if (body.trim()) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { message: body.trim() };
    }
  }

  if (!response.ok) {
    const message = extractLmStudioError(parsed) || body.trim() || response.statusText;
    throw new Error(`LM Studio API error ${response.status} at ${url}: ${message}`);
  }

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function extractLmStudioError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const error = (parsed as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  const message = (parsed as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function envModelOption(
  id: string,
  label: string,
  lane: RuntimeLane,
  provider: RuntimeModelProvider,
): RuntimeModelOption {
  return {
    id,
    label: `${label}: ${id}`,
    lane,
    provider,
    source: "env",
  };
}

function uniqueModels(models: RuntimeModelOption[]): RuntimeModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = `${model.provider}:${model.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
