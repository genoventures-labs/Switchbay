import fs from "node:fs";
import path from "node:path";
import { DEFAULTS } from "../config/defaults";
import { userConfigPath } from "../config/paths";

export type LocalProviderId = "ollama";

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
  },
};

let cached: LocalProvidersConfig | null = null;

export function localProvidersConfigPath(): string {
  return userConfigPath(CONFIG_FILE);
}

export function normalizeLocalProvider(value?: string | null): LocalProviderId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "ollama" || normalized === "ol" || normalized === "huggingface" || normalized === "hf" || normalized === "hf.co") {
    return "ollama";
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
  return "ollama";
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
    "Switch with `/lane ollama`, `/lane hf`, or `switchbay local-provider set ollama`.",
  ].join("\n");
}

export function invalidateLocalProvidersConfig(): void {
  cached = null;
}

function normalizeConfig(parsed: Partial<LocalProvidersConfig>): LocalProvidersConfig {
  const providers = {
    ollama: normalizeProvider(parsed.providers?.ollama, DEFAULT_CONFIG.providers.ollama),
  };
  const active = "ollama";
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
  return {
    ...config,
    active: "ollama",
    providers: {
      ollama: {
        ...config.providers.ollama,
        apiBase: ollamaBase ? normalizeProviderBase("ollama", ollamaBase, config.providers.ollama.apiBase) : config.providers.ollama.apiBase,
        model: ollamaModel?.trim() || config.providers.ollama.model,
      },
    },
  };
}

function normalizeProviderBase(provider: LocalProviderId, value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (provider === "ollama") {
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
