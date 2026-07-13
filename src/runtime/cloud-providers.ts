import fs from "node:fs";
import path from "node:path";
import { DEFAULTS } from "../config/defaults";
import { userConfigPath } from "../config/paths";
import { readConfiguredSecret } from "../config/secrets";

export type CloudProviderId = "openai" | "anthropic" | "google";
export type CloudProviderMode = "auto" | CloudProviderId;

export type CloudProviderConfig = {
  id: CloudProviderId;
  label: string;
  apiBase: string;
  apiKeyEnv: string;
  model: string;
};

export type CloudProvidersConfig = {
  active: CloudProviderMode;
  providers: Record<CloudProviderId, CloudProviderConfig>;
};

const CONFIG_FILE = "cloud-providers.json";

const DEFAULT_CONFIG: CloudProvidersConfig = {
  active: "auto",
  providers: {
    openai: {
      id: "openai",
      label: "OpenAI",
      apiBase: DEFAULTS.openAiBase,
      apiKeyEnv: "OPENAI_API_KEY",
      model: DEFAULTS.openAiModel,
    },
    anthropic: {
      id: "anthropic",
      label: "Anthropic",
      apiBase: DEFAULTS.anthropicBase,
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: DEFAULTS.anthropicModel,
    },
    google: {
      id: "google",
      label: "Google Gemini",
      apiBase: DEFAULTS.googleBase,
      apiKeyEnv: "GOOGLE_API_KEY",
      model: DEFAULTS.googleModel,
    },
  },
};

let cached: CloudProvidersConfig | null = null;

export function cloudProvidersConfigPath(): string {
  return userConfigPath(CONFIG_FILE);
}

export function normalizeCloudProvider(value?: string | null): CloudProviderMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "auto" || normalized === "router" || normalized === "cloud") return "auto";
  if (normalized === "openai" || normalized === "open-ai" || normalized === "gpt") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "google" || normalized === "gemini" || normalized === "google-ai") return "google";
  return null;
}

export function loadCloudProvidersConfig(): CloudProvidersConfig {
  if (cached) return cached;
  const target = cloudProvidersConfigPath();
  try {
    if (fs.existsSync(target)) {
      const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<CloudProvidersConfig>;
      cached = normalizeConfig(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults.
  }
  cached = applyEnv({ ...DEFAULT_CONFIG, providers: { ...DEFAULT_CONFIG.providers } });
  return cached;
}

export function saveCloudProvidersConfig(config: CloudProvidersConfig): void {
  const normalized = normalizeConfig(config);
  const target = cloudProvidersConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  cached = normalized;
}

export function getActiveCloudProvider(): CloudProviderMode {
  return normalizeCloudProvider(Bun.env.SWITCHBAY_CLOUD_PROVIDER ?? Bun.env.SWITCHBAY_CLOUD_ROUTER)
    ?? loadCloudProvidersConfig().active;
}

export function setActiveCloudProvider(provider: CloudProviderMode): CloudProvidersConfig {
  const config = loadCloudProvidersConfig();
  const next = { ...config, active: provider };
  saveCloudProvidersConfig(next);
  return next;
}

export function getCloudProviderConfig(provider: CloudProviderId): CloudProviderConfig {
  return loadCloudProvidersConfig().providers[provider];
}

export function getCloudProviderApiKey(provider: CloudProviderId): string | undefined {
  const keyName = getCloudProviderConfig(provider).apiKeyEnv;
  return provider === "google"
    ? readConfiguredSecret(keyName, "GEMINI_API_KEY")
    : readConfiguredSecret(keyName);
}

export function hasCloudProviderKey(provider: CloudProviderId): boolean {
  return Boolean(getCloudProviderApiKey(provider));
}

export function describeCloudProviders(): string {
  const config = loadCloudProvidersConfig();
  const rows = (Object.values(config.providers) as CloudProviderConfig[])
    .map((provider) => {
      const active = config.active === provider.id ? "*" : " ";
      const keyStatus = getCloudProviderApiKey(provider.id) ? "key=set" : `key=${provider.apiKeyEnv}`;
      return `${active} ${provider.id} - ${provider.label} (${provider.apiBase}) model=${provider.model} ${keyStatus}`;
    });
  return [
    "Cloud model providers",
    `Config: ${cloudProvidersConfigPath()}`,
    `Active: ${config.active}`,
    "",
    ...rows,
    "",
    "Switch with `/lane openai`, `/lane anthropic`, `/lane gemini`, or `switchbay cloud-provider set auto|openai|anthropic|gemini`.",
  ].join("\n");
}

export function describeAutoModelPool(): string {
  const intents: Record<CloudProviderId, string> = {
    openai: "structured output · summaries · vision",
    anthropic: "code · tools · workspace implementation",
    google: "research · comparison · long-context synthesis",
  };
  const rows = (["openai", "anthropic", "google"] as CloudProviderId[]).map((id) => {
    const provider = getCloudProviderConfig(id);
    const ready = hasCloudProviderKey(id) ? "ready" : `missing ${provider.apiKeyEnv}`;
    return `  ${id === "google" ? "gemini" : id.padEnd(9)} ${provider.model} · ${ready}\n             ${intents[id]}`;
  });
  return [
    "Trusted cloud auto pool",
    ...rows,
    "",
    "Explicit-only contained lanes: huggingface · openrouter · ollama-cloud",
    "Trusted local lane: ollama",
  ].join("\n");
}

export function invalidateCloudProvidersConfig(): void {
  cached = null;
}

function normalizeConfig(parsed: Partial<CloudProvidersConfig>): CloudProvidersConfig {
  const providers = {
    openai: normalizeProvider(parsed.providers?.openai, DEFAULT_CONFIG.providers.openai),
    anthropic: normalizeProvider(parsed.providers?.anthropic, DEFAULT_CONFIG.providers.anthropic),
    google: normalizeProvider(parsed.providers?.google, DEFAULT_CONFIG.providers.google),
  };
  const active = normalizeCloudProvider(parsed.active) ?? DEFAULT_CONFIG.active;
  return applyEnv({ active, providers });
}

function normalizeProvider(value: unknown, fallback: CloudProviderConfig): CloudProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const raw = value as Record<string, unknown>;
  return {
    ...fallback,
    label: String(raw.label ?? fallback.label).trim() || fallback.label,
    apiBase: normalizeBase(fallback.id, String(raw.apiBase ?? fallback.apiBase), fallback.apiBase),
    apiKeyEnv: String(raw.apiKeyEnv ?? fallback.apiKeyEnv).trim() || fallback.apiKeyEnv,
    model: String(raw.model ?? fallback.model).trim() || fallback.model,
  };
}

function applyEnv(config: CloudProvidersConfig): CloudProvidersConfig {
  const openAiBase = Bun.env.SWITCHBAY_OPENAI_BASE || Bun.env.OPENAI_BASE_URL;
  const openAiModel = Bun.env.SWITCHBAY_OPENAI_MODEL || Bun.env.OPENAI_MODEL;
  const anthropicBase = Bun.env.SWITCHBAY_ANTHROPIC_BASE || Bun.env.ANTHROPIC_BASE_URL;
  const anthropicModel = Bun.env.SWITCHBAY_ANTHROPIC_MODEL || Bun.env.ANTHROPIC_MODEL;
  const googleBase = Bun.env.SWITCHBAY_GOOGLE_BASE || Bun.env.GOOGLE_BASE_URL || Bun.env.GEMINI_BASE_URL;
  const googleModel = Bun.env.SWITCHBAY_GOOGLE_MODEL || Bun.env.GOOGLE_MODEL || Bun.env.GEMINI_MODEL;
  return {
    ...config,
    active: normalizeCloudProvider(Bun.env.SWITCHBAY_CLOUD_PROVIDER ?? Bun.env.SWITCHBAY_CLOUD_ROUTER) ?? config.active,
    providers: {
      openai: {
        ...config.providers.openai,
        apiBase: openAiBase ? normalizeBase("openai", openAiBase, config.providers.openai.apiBase) : config.providers.openai.apiBase,
        model: openAiModel?.trim() || config.providers.openai.model,
      },
      anthropic: {
        ...config.providers.anthropic,
        apiBase: anthropicBase ? normalizeBase("anthropic", anthropicBase, config.providers.anthropic.apiBase) : config.providers.anthropic.apiBase,
        model: anthropicModel?.trim() || config.providers.anthropic.model,
      },
      google: {
        ...config.providers.google,
        apiBase: googleBase ? normalizeBase("google", googleBase, config.providers.google.apiBase) : config.providers.google.apiBase,
        model: googleModel?.trim() || config.providers.google.model,
      },
    },
  };
}

function normalizeBase(provider: CloudProviderId, value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (provider === "google") {
    if (trimmed.endsWith("/openai")) return trimmed;
    if (trimmed.endsWith("/openai/")) return trimmed.replace(/\/$/, "");
    if (trimmed.endsWith("/v1beta")) return `${trimmed}/openai`;
    return trimmed.replace(/\/$/, "");
  }
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed.replace(/\/$/, "")}/v1`;
}
