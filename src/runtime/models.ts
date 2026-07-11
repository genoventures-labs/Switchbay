import {
  type CloudProvider,
  type RuntimeLane,
} from "../config/env";
import { getCloudProviderConfig } from "./cloud-providers";
import { loadCloudModelCatalog } from "./cloud-model-catalog";
import { getActiveLocalProvider, getLocalProviderConfig } from "./local-providers";

export type RuntimeModelProvider = Exclude<CloudProvider, "auto"> | "ollama";

export type RuntimeModelOption = {
  id: string;
  label: string;
  lane: RuntimeLane;
  provider: RuntimeModelProvider;
  source: "preset" | "env" | "custom" | "ollama";
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
  const openAi = getCloudProviderConfig("openai");
  const anthropic = getCloudProviderConfig("anthropic");
  const google = getCloudProviderConfig("google");
  return uniqueModels([
    envModelOption(openAi.model, "OpenAI configured default", lane, "openai"),
    envModelOption(anthropic.model, "Anthropic configured default", lane, "anthropic"),
    envModelOption(google.model, "Google configured default", lane, "google"),
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
    return { models: getCloudModelPresetsForLane(lane) };
  }

  return listOllamaModels();
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
        username = parts[0];
        repository = parts[1];
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
      const repoPath = parts[0];
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
