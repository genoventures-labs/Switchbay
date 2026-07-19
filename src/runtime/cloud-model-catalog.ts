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

export type VerifyCloudModelResult = {
  ok: boolean;
  /**
   * Machine-readable reason for non-ok results.
   * "not_found" — provider API actively rejected the model (4xx response).
   * "no_key"    — API key not configured; cannot verify but don't block.
   * "timeout"   — verification request timed out; don't block.
   * "error"     — other network or fetch error; don't block.
   */
  reason?: "not_found" | "no_key" | "timeout" | "error";
  /** Human-readable detail. No trailing "Added anyway." — caller decides. */
  notice?: string;
};

const CATALOG_FILE = "cloud-models.json";
const VERIFY_TIMEOUT_MS = 5000;

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

  if (options.verify !== false) {
    const verification = await verifyCloudModel(id, provider, options.fetchImpl ?? fetch);
    verified = verification.ok;
    notice = verification.notice;
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

export async function reverifyCloudModel(id: string, provider: CloudProviderId, fetchImpl: FetchLike = fetch): Promise<{ catalog: CloudModelCatalog; verified: boolean; notice?: string }> {
  const existing = loadCloudModelCatalog();
  const entry = existing.models.find((m) => m.id === id && m.provider === provider);
  if (!entry) throw new Error(`Model not found in catalog: ${id} (${provider})`);

  const verification = await verifyCloudModel(id, provider, fetchImpl);
  const now = new Date().toISOString();
  const updated: CustomCloudModel = {
    ...entry,
    ...(verification.ok ? { verifiedAt: now } : {}),
    ...(!verification.ok && entry.verifiedAt ? { verifiedAt: undefined } : {}),
  };
  const models = existing.models.map((m) => m.id === id && m.provider === provider ? updated : m);
  const catalog = saveCloudModelCatalog({ models });
  return { catalog, verified: verification.ok, notice: verification.notice };
}

export type RemoveCloudModelResult = {
  catalog: CloudModelCatalog;
  removed: boolean;
};

export function removeCloudModel(id: string, provider?: CloudProviderId | null): RemoveCloudModelResult {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Cloud model id is required.");
  const existing = loadCloudModelCatalog();
  const before = existing.models.length;
  const models = existing.models.filter((item) => {
    if (item.id !== trimmed) return true;
    if (provider && item.provider !== provider) return true;
    return false;
  });
  if (models.length === before) return { catalog: existing, removed: false };
  const catalog = saveCloudModelCatalog({ models });
  return { catalog, removed: true };
}

export function removeCloudModelsByProvider(provider: CloudProviderId): { removed: number } {
  const existing = loadCloudModelCatalog();
  const before = existing.models.length;
  const models = existing.models.filter((m) => m.provider !== provider);
  saveCloudModelCatalog({ models });
  return { removed: before - models.length };
}

export function clearCloudModelCatalog(): { removed: number } {
  const existing = loadCloudModelCatalog();
  const removed = existing.models.length;
  saveCloudModelCatalog({ models: [] });
  return { removed };
}

export function invalidateCloudModelCatalog(): void {
  cached = null;
}

export async function verifyCloudModel(id: string, provider: CloudProviderId, fetchImpl: FetchLike = fetch): Promise<VerifyCloudModelResult> {
  if (provider === "openai") return verifyOpenAiModel(id, fetchImpl);
  if (provider === "anthropic") return verifyAnthropicModel(id, fetchImpl);
  if (provider === "google") return verifyGoogleModel(id, fetchImpl);
  return { ok: false, notice: `Unknown provider: ${provider}` };
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

/** Extract the human-readable message from a provider error response body. */
function parseProviderError(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.detail;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  } catch { /* not JSON */ }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "";
}

async function verifyOpenAiModel(id: string, fetchImpl: FetchLike): Promise<VerifyCloudModelResult> {
  const config = getCloudProviderConfig("openai");
  const apiKey = getCloudProviderApiKey("openai");
  if (!apiKey) {
    return { ok: false, reason: "no_key", notice: `${config.apiKeyEnv} is not set — skipping verification.` };
  }
  try {
    const response = await fetchImpl(`${config.apiBase}/models/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const body = await response.text().catch(() => "");
    const detail = parseProviderError(body);
    return {
      ok: false,
      reason: "not_found",
      notice: detail || `OpenAI returned ${response.status}`,
    };
  } catch (error: any) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "timeout" : "error",
      notice: timedOut
        ? `OpenAI verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s.`
        : `OpenAI verification failed: ${error.message}`,
    };
  }
}

async function verifyAnthropicModel(id: string, fetchImpl: FetchLike): Promise<VerifyCloudModelResult> {
  const config = getCloudProviderConfig("anthropic");
  const apiKey = getCloudProviderApiKey("anthropic");
  if (!apiKey) {
    return { ok: false, reason: "no_key", notice: `${config.apiKeyEnv} is not set — skipping verification.` };
  }
  try {
    const response = await fetchImpl(`${config.apiBase}/models/${encodeURIComponent(id)}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const body = await response.text().catch(() => "");
    const detail = parseProviderError(body);
    return {
      ok: false,
      reason: "not_found",
      notice: detail || `Anthropic returned ${response.status}`,
    };
  } catch (error: any) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "timeout" : "error",
      notice: timedOut
        ? `Anthropic verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s.`
        : `Anthropic verification failed: ${error.message}`,
    };
  }
}

async function verifyGoogleModel(id: string, fetchImpl: FetchLike): Promise<VerifyCloudModelResult> {
  const apiKey = getCloudProviderApiKey("google");
  if (!apiKey) {
    return { ok: false, reason: "no_key", notice: "GOOGLE_API_KEY is not set — skipping verification." };
  }
  // Use the native Generative Language API — the OpenAI-compat base doesn't expose model detail endpoints
  const nativeBase = "https://generativelanguage.googleapis.com/v1beta";
  try {
    const response = await fetchImpl(`${nativeBase}/models/${encodeURIComponent(id)}?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const body = await response.text().catch(() => "");
    const detail = parseProviderError(body);
    return {
      ok: false,
      reason: "not_found",
      notice: detail || `Google returned ${response.status}`,
    };
  } catch (error: any) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "timeout" : "error",
      notice: timedOut
        ? `Google verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s.`
        : `Google verification failed: ${error.message}`,
    };
  }
}
