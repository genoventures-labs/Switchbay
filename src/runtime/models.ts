import {
  type CloudProvider,
  type RuntimeLane,
} from "../config/env";
import { loadCloudModelCatalog } from "./cloud-model-catalog";
import { getActiveLocalProvider, getLocalProviderConfig } from "./local-providers";
import { scanAvailableProviders } from "./cloud-providers";
import { readConfiguredSecret } from "../config/secrets";

export type RuntimeModelProvider = CloudProvider | "ollama" | "ollama-cloud" | "openrouter" | "huggingface" | "apple-fm" | "llama-cpp" | "mlx";

export type RuntimeModelOption = {
  id: string;
  label: string;
  lane: RuntimeLane;
  provider: RuntimeModelProvider;
  source: "auto" | "preset" | "custom" | "ollama" | "ollama-cloud" | "openrouter" | "huggingface" | "apple-fm" | "llama-cpp" | "mlx";
};

export type RuntimeModelList = {
  models: RuntimeModelOption[];
  notice?: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function getCloudModelPresets(): RuntimeModelOption[] {
  return getCloudModelPresetsForLane("cloud");
}

export function getCloudModelPresetsForLane(lane: Extract<RuntimeLane, "cloud" | "cloud-mcp">): RuntimeModelOption[] {
  // Only return models the user has explicitly added — no hardcoded presets.
  const customModels = loadCloudModelCatalog().models.map((model) => ({
    id: model.id,
    label: model.label ?? model.id,
    lane,
    provider: model.provider,
    source: "custom" as const,
  }));
  return uniqueModels(customModels);
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

  if (lane === "openrouter") {
    const available = scanAvailableProviders();
    if (!available.has("openrouter")) return { models: [], notice: "Set OPENROUTER_API_KEY to use OpenRouter." };
    return listOpenRouterModels();
  }
  if (lane === "huggingface") {
    const available = scanAvailableProviders();
    if (!available.has("huggingface")) return { models: [], notice: "Set HF_TOKEN to use Hugging Face Inference Providers." };
    return listHuggingFaceModels();
  }
  if (lane === "apple") return listAppleFmModels();
  if (lane === "litert") return listLiteRtModels();

  if (localProvider === "apple-fm") return listAppleFmModels();
  if (localProvider === "llama-cpp") return listOpenAiCompatLocalModels("llama-cpp");
  if (localProvider === "mlx") return listOpenAiCompatLocalModels("mlx");
  return listOllamaModels(undefined, localProvider as "ollama" | "ollama-cloud");
}

export async function listLiteRtModels(): Promise<RuntimeModelList> {
  try {
    const { liteRtServerModels, isLiteRtServerRunning } = await import("./litert-lm");
    const running = await isLiteRtServerRunning();
    if (!running) return { models: [], notice: "Not connected — run: switchbay litert serve" };
    const serverModels = await liteRtServerModels();
    const models: RuntimeModelOption[] = serverModels.map((m) => ({
      id: m.id,
      label: m.id,
      lane: "litert" as const,
      provider: "litert-lm" as any,
      source: "litert-lm" as any,
    }));
    return { models, notice: models.length ? undefined : "Server running but no models loaded — import one: switchbay litert import" };
  } catch {
    return { models: [], notice: "Not connected" };
  }
}

export async function listAppleFmModels(): Promise<RuntimeModelList> {
  return {
    models: [
      {
        id: "apple-fm/core",
        label: "AFM 3 Core  ·  3B dense  ·  on-device  ·  fast",
        lane: "apple" as const,
        provider: "apple-fm" as const,
        source: "apple-fm" as const,
      },
      {
        id: "apple-fm/core-advanced",
        label: "AFM 3 Core Advanced  ·  20B sparse  ·  on-device  ·  multimodal",
        lane: "apple" as const,
        provider: "apple-fm" as const,
        source: "apple-fm" as const,
      },
      {
        id: "apple-fm/cloud",
        label: "AFM 3 Cloud  ·  Private Cloud Compute  ·  fast",
        lane: "apple" as const,
        provider: "apple-fm" as const,
        source: "apple-fm" as const,
      },
      {
        id: "apple-fm/cloud-pro",
        label: "AFM 3 Cloud Pro  ·  Private Cloud Compute  ·  reasoning",
        lane: "apple" as const,
        provider: "apple-fm" as const,
        source: "apple-fm" as const,
      },
      {
        id: "apple-fm/image",
        label: "AFM 3 Cloud Image  ·  image generation  ·  coming soon",
        lane: "apple" as const,
        provider: "apple-fm" as const,
        source: "apple-fm" as const,
      },
    ],
    notice: "Apple Intelligence runs on-device (Core, Core Advanced) and via Private Cloud Compute (Cloud, Cloud Pro). Requires macOS 26 Tahoe with Apple Intelligence enabled.",
  };
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
      notice: models.length ? undefined : "Not connected",
    };
  } catch {
    return { models: [], notice: "Not connected" };
  }
}



export async function listOpenAiCompatLocalModels(
  provider: "llama-cpp" | "mlx",
  fetchImpl: FetchLike = fetch,
): Promise<RuntimeModelList> {
  const config = getLocalProviderConfig(provider);
  const label = config.label;
  const apiBase = config.apiBase;
  try {
    const response = await fetchImpl(`${apiBase}/models`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return { models: [], notice: serverNotRunningNotice(provider, label, apiBase) };
    }
    const parsed = JSON.parse(body) as { data?: Array<{ id?: string }> };
    const models: RuntimeModelOption[] = (parsed.data ?? []).flatMap((m) => {
      const id = m.id?.trim();
      if (!id) return [];
      return [{ id, label: id, lane: "local" as const, provider, source: provider }];
    });
    return {
      models: uniqueModels(models),
      notice: models.length ? undefined : `${label} is running but has no loaded model. Start with a model first.`,
    };
  } catch {
    return { models: [], notice: serverNotRunningNotice(provider, label, apiBase) };
  }
}

function serverNotRunningNotice(_provider: "llama-cpp" | "mlx", _label: string, _apiBase: string): string {
  return "Not connected";
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
