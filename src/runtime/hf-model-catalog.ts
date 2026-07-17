import fs from "node:fs";
import path from "node:path";
import { userConfigPath } from "../config/paths";

export type HfModelProvider = "llama-cpp" | "mlx";

export type HfLocalModel = {
  repo: string;
  provider: HfModelProvider;
  localPath: string;
  pulledAt: string;
  /** Specific GGUF filename, for llama-cpp pulls */
  file?: string;
};

export type HfLocalModelCatalog = {
  models: HfLocalModel[];
};

const CATALOG_FILE = "hf-models.json";

let cached: HfLocalModelCatalog | null = null;

export function hfModelCatalogPath(): string {
  return userConfigPath(CATALOG_FILE);
}

export function hfModelsDir(): string {
  return userConfigPath("models");
}

export function hfModelLocalPath(repo: string): string {
  const safe = repo.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(hfModelsDir(), safe);
}

export function loadHfModelCatalog(): HfLocalModelCatalog {
  if (cached) return cached;
  const target = hfModelCatalogPath();
  try {
    if (fs.existsSync(target)) {
      cached = normalizeCatalog(JSON.parse(fs.readFileSync(target, "utf-8")));
      return cached;
    }
  } catch { /* fall through */ }
  cached = { models: [] };
  return cached;
}

export function saveHfModelCatalog(catalog: HfLocalModelCatalog): HfLocalModelCatalog {
  const normalized = normalizeCatalog(catalog);
  const target = hfModelCatalogPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  cached = normalized;
  return normalized;
}

export function registerHfModel(entry: Omit<HfLocalModel, "pulledAt">): HfLocalModel {
  const existing = loadHfModelCatalog();
  const now = new Date().toISOString();
  const model: HfLocalModel = { ...entry, pulledAt: now };
  const models = [
    model,
    ...existing.models.filter((m) => !(m.repo === entry.repo && m.provider === entry.provider)),
  ];
  saveHfModelCatalog({ models });
  return model;
}

export function listHfLocalModels(provider?: HfModelProvider): HfLocalModel[] {
  const catalog = loadHfModelCatalog();
  return provider ? catalog.models.filter((m) => m.provider === provider) : catalog.models;
}

export function invalidateHfModelCatalog(): void {
  cached = null;
}

function normalizeCatalog(value: unknown): HfLocalModelCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { models: [] };
  const raw = value as Record<string, unknown>;
  const models = Array.isArray(raw.models) ? raw.models.flatMap(normalizeEntry) : [];
  return { models };
}

function normalizeEntry(value: unknown): HfLocalModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const repo = String(raw.repo ?? "").trim();
  const provider = String(raw.provider ?? "") as HfModelProvider;
  const localPath = String(raw.localPath ?? "").trim();
  if (!repo || !localPath || (provider !== "llama-cpp" && provider !== "mlx")) return [];
  return [{
    repo,
    provider,
    localPath,
    pulledAt: String(raw.pulledAt ?? new Date().toISOString()),
    ...(raw.file ? { file: String(raw.file) } : {}),
  }];
}
