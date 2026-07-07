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
  { id: "gpt-5", label: "GPT-5", lane: "cloud", provider: "openai", source: "preset" },
  { id: "gpt-5-mini", label: "GPT-5 mini", lane: "cloud", provider: "openai", source: "preset" },
  { id: "gpt-5-nano", label: "GPT-5 nano", lane: "cloud", provider: "openai", source: "preset" },
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
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        models: [fallback],
        notice: `LM Studio model fetch failed: ${response.status}${body ? ` - ${body.slice(0, 120)}` : ""}`,
      };
    }

    const parsed = await response.json() as LmStudioModelsResponse;
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
