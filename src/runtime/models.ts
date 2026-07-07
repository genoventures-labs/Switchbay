import {
  getAnthropicModel,
  getDefaultModel,
  getLmStudioApiKey,
  getLmStudioBase,
  getOpenAiModel,
  type CloudProvider,
  type RuntimeLane,
} from "../config/env";

export type RuntimeModelProvider = Exclude<CloudProvider, "auto"> | "lmstudio";

export type RuntimeModelOption = {
  id: string;
  label: string;
  lane: RuntimeLane;
  provider: RuntimeModelProvider;
  source: "preset" | "env" | "lmstudio";
};

export type RuntimeModelList = {
  models: RuntimeModelOption[];
  notice?: string;
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

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function getCloudModelPresets(): RuntimeModelOption[] {
  return uniqueModels([
    envModelOption(getOpenAiModel(), "OpenAI env default", "cloud", "openai"),
    envModelOption(getAnthropicModel(), "Anthropic env default", "cloud", "anthropic"),
    ...OPENAI_PRESETS,
    ...ANTHROPIC_PRESETS,
  ]);
}

export async function listRuntimeModels(lane: RuntimeLane): Promise<RuntimeModelList> {
  if (lane === "cloud") {
    return { models: getCloudModelPresets() };
  }

  return listLmStudioModels();
}

export async function listLmStudioModels(fetchImpl: FetchLike = fetch): Promise<RuntimeModelList> {
  const fallback = envModelOption(getDefaultModel(), "LM Studio env default", "local", "lmstudio");
  const apiBase = getLmStudioBase();
  const headers: Record<string, string> = {};
  const apiKey = getLmStudioApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetchImpl(`${apiBase}/models`, { headers });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        models: [fallback],
        notice: formatLmStudioModelFetchError(apiBase, response.status, body, Boolean(apiKey)),
      };
    }

    let parsed: LmStudioModelsResponse;
    try {
      parsed = JSON.parse(body) as LmStudioModelsResponse;
    } catch {
      return {
        models: [fallback],
        notice: formatLmStudioModelFetchError(apiBase, response.status, body, Boolean(apiKey)),
      };
    }

    const models = (parsed.data ?? [])
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        id,
        label: id,
        lane: "local" as const,
        provider: "lmstudio" as const,
        source: "lmstudio" as const,
      }));

    return {
      models: uniqueModels([fallback, ...models]),
      notice: models.length === 0 ? "LM Studio returned no models; showing your configured default." : undefined,
    };
  } catch (error: any) {
    return {
      models: [fallback],
      notice: `Could not reach LM Studio at ${apiBase}: ${error.message}`,
    };
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
