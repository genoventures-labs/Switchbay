import fs from "node:fs";
import path from "node:path";
import { userConfigPath } from "../config/paths";
import { getCloudProviderApiKey, getCloudProviderConfig, type CloudProviderId } from "./cloud-providers";

export type CustomCloudModel = {
  id: string;
  label?: string;
  provider: CloudProviderId;
  addedAt: string;
  verifiedAt?: string;
};

export type CloudModelCatalog = {
  models: CustomCloudModel[];
};

export type AddCloudModelOptions = {
  id: string;
  label?: string | null;
  provider?: CloudProviderId | null;
  verify?: boolean;
  fetchImpl?: FetchLike;
};

export type AddCloudModelResult = {
  catalog: CloudModelCatalog;
  model: CustomCloudModel;
  verified: boolean;
  notice?: string;
};

const CATALOG_FILE = "cloud-models.json";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let cached: CloudModelCatalog | null = null;

export function cloudModelCatalogPath(): string {
  return userConfigPath(CATALOG_FILE);
}

export function loadCloudModelCatalog(): CloudModelCatalog {
  if (cached) return cached;
  const target = cloudModelCatalogPath();
  try {
    if (fs.existsSync(target)) {
      cached = normalizeCatalog(JSON.parse(fs.readFileSync(target, "utf-8")));
      return cached;
    }
  } catch {
    // Fall through to an empty catalog.
  }
  cached = { models: [] };
  return cached;
}

export function saveCloudModelCatalog(catalog: CloudModelCatalog): CloudModelCatalog {
  const normalized = normalizeCatalog(catalog);
  const target = cloudModelCatalogPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  cached = normalized;
  return normalized;
}

export async function addCloudModel(options: AddCloudModelOptions): Promise<AddCloudModelResult> {
  const id = options.id.trim();
  if (!id) throw new Error("Cloud model id is required.");
  const provider = options.provider ?? inferCloudModelProvider(id);
  const label = options.label?.trim() || undefined;
  let verified = false;
  let notice: string | undefined;

  if (options.verify !== false && provider === "openai") {
    const verification = await verifyOpenAiModel(id, options.fetchImpl ?? fetch);
    verified = verification.ok;
    notice = verification.notice;
  } else if (options.verify !== false && provider !== "openai") {
    notice = `${provider} model added without live validation.`;
  }

  const existing = loadCloudModelCatalog();
  const now = new Date().toISOString();
  const model: CustomCloudModel = {
    id,
    provider,
    addedAt: now,
    ...(label ? { label } : {}),
    ...(verified ? { verifiedAt: now } : {}),
  };
  const models = [
    model,
    ...existing.models.filter((item) => !(item.provider === provider && item.id === id)),
  ];
  const catalog = saveCloudModelCatalog({ models });
  return { catalog, model, verified, notice };
}

export function invalidateCloudModelCatalog(): void {
  cached = null;
}

function normalizeCatalog(value: unknown): CloudModelCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { models: [] };
  const raw = value as Record<string, unknown>;
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap(normalizeModel)
    : [];
  return { models };
}

function normalizeModel(value: unknown): CustomCloudModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const provider = normalizeProvider(String(raw.provider ?? ""));
  if (!id || !provider) return [];
  const label = String(raw.label ?? "").trim();
  const addedAt = String(raw.addedAt ?? "").trim() || new Date().toISOString();
  const verifiedAt = String(raw.verifiedAt ?? "").trim();
  return [{
    id,
    provider,
    addedAt,
    ...(label ? { label } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
  }];
}

function normalizeProvider(value: string): CloudProviderId | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "gpt") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "google" || normalized === "gemini") return "google";
  return null;
}

export function inferCloudModelProvider(id: string): CloudProviderId {
  const normalized = id.toLowerCase();
  if (normalized.startsWith("claude-")) return "anthropic";
  if (normalized.startsWith("gemini-")) return "google";
  return "openai";
}

async function verifyOpenAiModel(id: string, fetchImpl: FetchLike): Promise<{ ok: boolean; notice?: string }> {
  const config = getCloudProviderConfig("openai");
  const apiKey = getCloudProviderApiKey("openai");
  if (!apiKey) {
    return {
      ok: false,
      notice: `Added without OpenAI validation because ${config.apiKeyEnv} is not set.`,
    };
  }

  try {
    const response = await fetchImpl(`${config.apiBase}/models/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) return { ok: true };
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      notice: `OpenAI model validation returned ${response.status}${body.trim() ? `: ${body.trim().slice(0, 120)}` : ""}. Added anyway.`,
    };
  } catch (error: any) {
    return {
      ok: false,
      notice: `OpenAI model validation failed: ${error.message}. Added anyway.`,
    };
  }
}
