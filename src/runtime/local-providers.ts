import fs from "node:fs";
import path from "node:path";
import { DEFAULTS } from "../config/defaults";
import { userConfigPath } from "../config/paths";

export type LocalProviderId = "ollama" | "ollama-cloud" | "apple-fm" | "llama-cpp" | "mlx" | "litert-lm";

export type LocalProviderConfig = {
  id: LocalProviderId;
  label: string;
  apiBase: string;
  model?: string;
};

export type LocalProvidersConfig = {
  active: LocalProviderId;
  providers: Record<LocalProviderId, LocalProviderConfig>;
};

const CONFIG_FILE = "local-providers.json";

const DEFAULT_CONFIG: LocalProvidersConfig = {
  active: "ollama",
  providers: {
    ollama: {
      id: "ollama",
      label: "Ollama",
      apiBase: DEFAULTS.ollamaBase,
      model: DEFAULTS.ollamaModel,
    },
    "ollama-cloud": {
      id: "ollama-cloud",
      label: "Ollama Cloud",
      apiBase: "https://ollama.com/api",
      model: "gpt-oss:120b",
    },
    "apple-fm": {
      id: "apple-fm",
      label: "Apple Intelligence",
      apiBase: "local",
      model: "default",
    },
    "llama-cpp": {
      id: "llama-cpp",
      label: "llama.cpp",
      apiBase: "http://localhost:8080/v1",
    },
    "mlx": {
      id: "mlx",
      label: "MLX (Apple Silicon)",
      apiBase: "http://localhost:8080/v1",
    },
    "litert-lm": {
      id: "litert-lm",
      label: "LiteRT-LM (Google Edge)",
      apiBase: "http://localhost:9379/v1",
    },
  },
};

let cached: LocalProvidersConfig | null = null;

export function localProvidersConfigPath(): string {
  return userConfigPath(CONFIG_FILE);
}

export function normalizeLocalProvider(value?: string | null): LocalProviderId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "ollama" || normalized === "ol" || normalized === "hf.co") {
    return "ollama";
  }
  if (normalized === "ollama-cloud" || normalized === "ollama_cloud" || normalized === "oc" || normalized === "ollama.com") {
    return "ollama-cloud";
  }
  if (normalized === "apple-fm" || normalized === "apple" || normalized === "apple-intelligence" || normalized === "ai" || normalized === "on-device") {
    return "apple-fm";
  }
  if (normalized === "llama-cpp" || normalized === "llama_cpp" || normalized === "llamacpp" || normalized === "llama" || normalized === "llama-server") {
    return "llama-cpp";
  }
  if (normalized === "mlx" || normalized === "mlx-lm" || normalized === "mlxlm" || normalized === "apple-mlx") {
    return "mlx";
  }
  if (normalized === "litert-lm" || normalized === "litert" || normalized === "edge" || normalized === "google-edge" || normalized === "lm") {
    return "litert-lm";
  }
  return null;
}

export function loadLocalProvidersConfig(): LocalProvidersConfig {
  if (cached) return cached;
  const target = localProvidersConfigPath();
  try {
    if (fs.existsSync(target)) {
      const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<LocalProvidersConfig>;
      cached = normalizeConfig(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults.
  }
  cached = applyEnv({ ...DEFAULT_CONFIG, providers: { ...DEFAULT_CONFIG.providers } });
  return cached;
}

export function saveLocalProvidersConfig(config: LocalProvidersConfig): void {
  const normalized = normalizeConfig(config);
  const target = localProvidersConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  cached = normalized;
}

export function getActiveLocalProvider(): LocalProviderId {
  return normalizeLocalProvider(Bun.env.SWITCHBAY_LOCAL_PROVIDER) ?? loadLocalProvidersConfig().active;
}

export function setActiveLocalProvider(provider: LocalProviderId): LocalProvidersConfig {
  const config = loadLocalProvidersConfig();
  const next = { ...config, active: provider };
  saveLocalProvidersConfig(next);
  return next;
}

export function getLocalProviderConfig(provider: LocalProviderId = getActiveLocalProvider()): LocalProviderConfig {
  return loadLocalProvidersConfig().providers[provider];
}

export function describeLocalProviders(): string {
  const config = loadLocalProvidersConfig();
  const rows = (Object.values(config.providers) as LocalProviderConfig[])
    .map((provider) => `${provider.id === config.active ? "*" : " "} ${provider.id} - ${provider.label} (${provider.apiBase})${provider.model ? ` model=${provider.model}` : ""}`);
  return [
    "Local model providers",
    `Config: ${localProvidersConfigPath()}`,
    "",
    ...rows,
    "",
    "Switch with `/lane ollama`, `/lane ollama-cloud`, `/lane apple`, `/lane llama-cpp`, `/lane mlx`, or `switchbay local-provider set ollama|ollama-cloud|apple-fm|llama-cpp|mlx`.",
  ].join("\n");
}

export function invalidateLocalProvidersConfig(): void {
  cached = null;
}

function normalizeConfig(parsed: Partial<LocalProvidersConfig>): LocalProvidersConfig {
  const providers: Record<LocalProviderId, LocalProviderConfig> = {
    ollama: normalizeProvider(parsed.providers?.["ollama"], DEFAULT_CONFIG.providers["ollama"]),
    "ollama-cloud": normalizeProvider(parsed.providers?.["ollama-cloud"], DEFAULT_CONFIG.providers["ollama-cloud"]),
    "apple-fm": normalizeProvider(parsed.providers?.["apple-fm"], DEFAULT_CONFIG.providers["apple-fm"]),
    "llama-cpp": normalizeProvider(parsed.providers?.["llama-cpp"], DEFAULT_CONFIG.providers["llama-cpp"]),
    "mlx": normalizeProvider(parsed.providers?.["mlx"], DEFAULT_CONFIG.providers["mlx"]),
    "litert-lm": normalizeProvider(parsed.providers?.["litert-lm"], DEFAULT_CONFIG.providers["litert-lm"]),
  };
  const active = normalizeLocalProvider(parsed.active) ?? DEFAULT_CONFIG.active;
  return applyEnv({ active, providers });
}

function normalizeProvider(value: unknown, fallback: LocalProviderConfig): LocalProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const raw = value as Record<string, unknown>;
  return {
    ...fallback,
    label: String(raw.label ?? fallback.label).trim() || fallback.label,
    apiBase: normalizeProviderBase(fallback.id, String(raw.apiBase ?? fallback.apiBase), fallback.apiBase),
    model: String(raw.model ?? fallback.model ?? "").trim() || fallback.model,
  };
}

function applyEnv(config: LocalProvidersConfig): LocalProvidersConfig {
  const lmBase = Bun.env.SWITCHBAY_LMSTUDIO_BASE || Bun.env.LMSTUDIO_API_BASE || Bun.env.LMSTUDIO_API_URL;
  const lmModel = Bun.env.SWITCHBAY_LMSTUDIO_MODEL || Bun.env.LMSTUDIO_DEFAULT_MODEL;
  const ollamaBase = Bun.env.SWITCHBAY_OLLAMA_BASE || Bun.env.OLLAMA_API_BASE || Bun.env.OLLAMA_HOST || lmBase;
  const ollamaModel = Bun.env.SWITCHBAY_OLLAMA_MODEL || Bun.env.OLLAMA_MODEL || lmModel;
  const ollamaCloudBase = Bun.env.SWITCHBAY_OLLAMA_CLOUD_BASE || Bun.env.OLLAMA_CLOUD_BASE;
  const ollamaCloudModel = Bun.env.SWITCHBAY_OLLAMA_CLOUD_MODEL || Bun.env.OLLAMA_CLOUD_MODEL;
  const llamaCppBase = Bun.env.SWITCHBAY_LLAMA_CPP_BASE || Bun.env.LLAMA_CPP_API_BASE;
  const mlxBase = Bun.env.SWITCHBAY_MLX_BASE || Bun.env.MLX_API_BASE;
  return {
    ...config,
    active: normalizeLocalProvider(Bun.env.SWITCHBAY_LOCAL_PROVIDER) ?? config.active,
    providers: {
      ollama: {
        ...config.providers.ollama,
        apiBase: ollamaBase ? normalizeProviderBase("ollama", ollamaBase, config.providers.ollama.apiBase) : config.providers.ollama.apiBase,
        model: ollamaModel?.trim() || config.providers.ollama.model,
      },
      "ollama-cloud": {
        ...config.providers["ollama-cloud"],
        apiBase: ollamaCloudBase ? normalizeProviderBase("ollama-cloud", ollamaCloudBase, config.providers["ollama-cloud"].apiBase) : config.providers["ollama-cloud"].apiBase,
        model: ollamaCloudModel?.trim() || config.providers["ollama-cloud"].model,
      },
      "apple-fm": {
        id: "apple-fm" as const,
        label: config.providers["apple-fm"]?.label ?? "Apple Intelligence",
        apiBase: config.providers["apple-fm"]?.apiBase ?? "local",
        model: Bun.env.SWITCHBAY_APPLE_FM_MODEL?.trim() || config.providers["apple-fm"]?.model || "default",
      },
      "llama-cpp": {
        ...config.providers["llama-cpp"],
        apiBase: llamaCppBase?.trim() || config.providers["llama-cpp"]?.apiBase || "http://localhost:8080/v1",
        model: Bun.env.SWITCHBAY_LLAMA_CPP_MODEL?.trim() || config.providers["llama-cpp"]?.model,
      },
      "mlx": {
        ...config.providers["mlx"],
        apiBase: mlxBase?.trim() || config.providers["mlx"]?.apiBase || "http://localhost:8080/v1",
        model: Bun.env.SWITCHBAY_MLX_MODEL?.trim() || config.providers["mlx"]?.model,
      },
      "litert-lm": {
        ...config.providers["litert-lm"],
        apiBase: Bun.env.SWITCHBAY_LITERT_BASE?.trim() || config.providers["litert-lm"]?.apiBase || "http://localhost:9379/v1",
        model: Bun.env.SWITCHBAY_LITERT_MODEL?.trim() || config.providers["litert-lm"]?.model,
      },
    },
  };
}

function normalizeProviderBase(provider: LocalProviderId, value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (provider === "llama-cpp" || provider === "mlx" || provider === "litert-lm") {
    // OpenAI-compat /v1 paths — preserve as-is
    if (!trimmed.endsWith("/v1")) return `${trimmed.replace(/\/$/, "")}/v1`;
    return trimmed;
  }
  if (provider === "ollama" || provider === "ollama-cloud") {
    let clean = trimmed;
    if (clean.endsWith("/v1")) {
      clean = clean.replace(/\/v1$/, "");
    } else if (clean.endsWith("/api/v1")) {
      clean = clean.replace(/\/api\/v1$/, "");
    }
    if (clean.endsWith("/api")) return clean;
    return `${clean.replace(/\/$/, "")}/api`;
  }
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed.replace(/\/$/, "")}/api`;
}
