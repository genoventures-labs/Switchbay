import {
  type CloudProvider,
  type RuntimeLane,
} from "../config/env";
import { loadCloudModelCatalog } from "./cloud-model-catalog";
import { getActiveLocalProvider, getLocalProviderConfig } from "./local-providers";
import { readConfiguredSecret } from "../config/secrets";

export type RuntimeModelProvider = CloudProvider | "ollama" | "ollama-cloud" | "openrouter" | "huggingface";

export type RuntimeModelOption = {
  id: string;
  label: string;
  lane: RuntimeLane;
  provider: RuntimeModelProvider;
  source: "auto" | "preset" | "custom" | "ollama" | "ollama-cloud" | "openrouter" | "huggingface";
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

const GOOGLE_PRESETS: RuntimeModelOption[] = [
  { id: "gemini-3.5-pro", label: "Gemini 3.5 Pro", lane: "cloud", provider: "google", source: "preset" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", lane: "cloud", provider: "google", source: "preset" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", lane: "cloud", provider: "google", source: "preset" },
];

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function getCloudModelPresets(): RuntimeModelOption[] {
  return getCloudModelPresetsForLane("cloud");
}

export function getCloudModelPresetsForLane(lane: Extract<RuntimeLane, "cloud" | "cloud-mcp">): RuntimeModelOption[] {
  return uniqueModels([
    ...loadCloudModelCatalog().models.map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      lane,
      provider: model.provider,
      source: "custom" as const,
    })),
    ...OPENAI_PRESETS.map((model) => ({ ...model, lane })),
    ...ANTHROPIC_PRESETS.map((model) => ({ ...model, lane })),
    ...GOOGLE_PRESETS.map((model) => ({ ...model, lane })),
  ]);
}

export async function listRuntimeModels(lane: RuntimeLane, localProvider = getActiveLocalProvider()): Promise<RuntimeModelList> {
  if (lane === "cloud" || lane === "cloud-mcp") {
    return {
      models: [
        { id: "auto", label: "Auto · trusted cloud routing", lane, provider: "auto", source: "auto" },
        ...getCloudModelPresetsForLane(lane),
      ],
    };
  }

  if (lane === "openrouter") return listOpenRouterModels();
  if (lane === "huggingface") return listHuggingFaceModels();

  return listOllamaModels(undefined, localProvider);
}

export async function listHuggingFaceModels(fetchImpl: FetchLike = fetch): Promise<RuntimeModelList> {
  const key = readConfiguredSecret("HF_TOKEN", "HUGGINGFACE_API_KEY");
  if (!key) return { models: [], notice: "Set HF_TOKEN to list hosted Hugging Face chat models." };
  try {
    const response = await fetchImpl(`${Bun.env.SWITCHBAY_HF_BASE?.trim() ?? "https://router.huggingface.co/v1"}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await response.text();
    if (!response.ok) return { models: [], notice: `Hugging Face model listing returned ${response.status}: ${body.slice(0, 160)}` };
    const parsed = JSON.parse(body) as { data?: Array<{ id?: string; name?: string; context_length?: number }> };
    const models = (parsed.data ?? []).flatMap((item) => {
      const id = item.id?.trim();
      if (!id) return [];
      const context = item.context_length ? ` · ${Math.round(item.context_length / 1000)}k ctx` : "";
      return [{ id, label: `${item.name?.trim() || id}${context}`, lane: "huggingface" as const, provider: "huggingface" as const, source: "huggingface" as const }];
    });
    return { models: uniqueModels(models) };
  } catch (error: any) {
    return { models: [], notice: `Could not reach Hugging Face Inference Providers: ${error.message}` };
  }
}

export async function listOpenRouterModels(fetchImpl: FetchLike = fetch): Promise<RuntimeModelList> {
  const key = readConfiguredSecret("OPENROUTER_API_KEY");
  if (!key) return { models: [], notice: "Set OPENROUTER_API_KEY to list OpenRouter models." };
  try {
    const response = await fetchImpl(`${Bun.env.SWITCHBAY_OPENROUTER_BASE?.trim() ?? "https://openrouter.ai/api/v1"}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await response.text();
    if (!response.ok) return { models: [], notice: `OpenRouter model listing returned ${response.status}: ${body.slice(0, 160)}` };
    const parsed = JSON.parse(body) as { data?: Array<{ id?: string; name?: string; context_length?: number }> };
    const models = (parsed.data ?? []).flatMap((item) => {
      const id = item.id?.trim();
      if (!id) return [];
      const context = item.context_length ? ` · ${Math.round(item.context_length / 1000)}k ctx` : "";
      return [{ id, label: `${item.name?.trim() || id}${context}`, lane: "openrouter" as const, provider: "openrouter" as const, source: "openrouter" as const }];
    });
    return { models: uniqueModels(models) };
  } catch (error: any) {
    return { models: [], notice: `Could not reach OpenRouter: ${error.message}` };
  }
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

export async function listOllamaModels(fetchImpl: FetchLike = fetch, provider: "ollama" | "ollama-cloud" = "ollama"): Promise<RuntimeModelList> {
  const config = getLocalProviderConfig(provider);
  try {
    const response = await fetchImpl(`${config.apiBase}/tags`, {
      headers: provider === "ollama-cloud" ? { Authorization: `Bearer ${readConfiguredSecret("OLLAMA_API_KEY") ?? ""}` } : undefined,
    });
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
          provider,
          source: provider,
        }];
      });
    return {
      models: uniqueModels(models),
      notice: models.length ? undefined : `${config.label} returned no models from ${config.apiBase}/tags.`,
    };
  } catch (error: any) {
    return { models: [], notice: `Could not reach ${config.label} at ${config.apiBase}: ${error.message}` };
  }
}



export function normalizeOllamaHuggingFaceModel(target: string, quantization?: string | null): string {
  const trimmed = target.trim();
  if (!trimmed) return "";

  let username = "";
  let repository = "";
  let tag = "";

  try {
    const url = new URL(trimmed);
    if (url.hostname === "huggingface.co" || url.hostname === "www.huggingface.co") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        username = parts[0]!;
        repository = parts[1]!;
        // If there's a specific GGUF file in the URL
        const ggufFile = parts.find(p => p.toLowerCase().endsWith(".gguf"));
        if (ggufFile) {
          tag = ggufFile;
        }
      }
    }
  } catch {
    // Not a valid URL, could be in the format "username/repository" or "hf.co/username/repository"
    if (trimmed.startsWith("hf.co/")) {
      const parts = trimmed.split(":");
      const repoPath = parts[0];
      const rest = parts.slice(1).join(":");
      const finalTag = quantization?.trim() || rest;
      return `${repoPath}${finalTag ? `:${finalTag}` : ""}`;
    } else if (trimmed.includes("/")) {
      // e.g. "username/repository" or "username/repository:tag"
      const parts = trimmed.split(":");
      const repoPath = parts[0]!;
      const rest = parts.slice(1).join(":");
      const repoParts = repoPath.split("/");
      if (repoParts.length === 2) {
        const finalTag = quantization?.trim() || rest;
        return `hf.co/${repoPath}${finalTag ? `:${finalTag}` : ""}`;
      }
    }
  }

  if (username && repository) {
    let finalTag = quantization?.trim() || tag;
    return `hf.co/${username}/${repository}${finalTag ? `:${finalTag}` : ""}`;
  }

  return trimmed;
}

export type OllamaPullOptions = {
  model: string;
  fetchImpl?: FetchLike;
  onProgress?: (progress: { status: string; completed?: number; total?: number }) => void;
};

export async function pullOllamaModel(options: OllamaPullOptions): Promise<{ model: string; status: string }> {
  const model = options.model.trim();
  if (!model) throw new Error("Ollama model name is required.");
  const config = getLocalProviderConfig("ollama");
  const response = await (options.fetchImpl ?? fetch)(`${config.apiBase}/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama API error ${response.status}: ${body.trim() || response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus = "pending";

  function processLine(line: string) {
    if (!line.trim()) return;
    try {
      const chunk = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (chunk.error) {
        throw new Error(chunk.error);
      }
      if (chunk.status) {
        lastStatus = chunk.status;
        if (options.onProgress) {
          options.onProgress({
            status: chunk.status,
            completed: chunk.completed,
            total: chunk.total,
          });
        }
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("JSON")) {
        throw err;
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        processLine(buffer);
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }
  }

  return { model, status: lastStatus };
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
