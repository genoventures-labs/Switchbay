import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { userConfigPath } from "./paths";
import type { CloudProvider, RuntimeLane } from "./env";

function configPath(): string {
  return userConfigPath("config.json");
}

export type SwitchbayConfig = {
  /** Explicit list of whitelisted locations the switchbay can travel to. */
  locations: string[];
  /** If true, auto-discover git repos under home dir (depth-limited). */
  auto_discover: boolean;
  /** Directories to exclude from auto-discovery. */
  discover_exclude: string[];
  /** Per-lane model pins set by the CLI/TUI. */
  selected_models: Partial<Record<RuntimeLane, SelectedRuntimeModel>>;
  /** Operator surfaces for Bay's local-first daily cockpit. */
  operator: OperatorConfig;
};

export type OperatorConfig = {
  enabled: boolean;
  startupOverview: boolean;
  dailyBoard: boolean;
};

export type SelectedRuntimeModel = {
  id: string;
  provider?: Exclude<CloudProvider, "auto"> | "lmstudio" | "lmstudio-mcp" | "ollama";
};

const DEFAULTS: SwitchbayConfig = {
  locations: [],
  auto_discover: true,
  discover_exclude: [
    "node_modules",
    ".git",
    "Library",
    "Applications",
    ".cache",
    ".local",
    ".config",
    "snap",
    "proc",
    "sys",
  ],
  selected_models: {},
  operator: {
    enabled: true,
    startupOverview: true,
    dailyBoard: true,
  },
};

let _cached: SwitchbayConfig | null = null;

export function loadSwitchbayConfig(): SwitchbayConfig {
  if (_cached) return _cached;

  try {
    const target = configPath();
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target, "utf-8");
      const parsed = JSON.parse(raw) as Partial<SwitchbayConfig>;
      _cached = {
        locations: Array.isArray(parsed.locations)
          ? parsed.locations.map((l) => resolveLocationInput(String(l)))
          : DEFAULTS.locations,
        auto_discover: parsed.auto_discover ?? DEFAULTS.auto_discover,
        discover_exclude: Array.isArray(parsed.discover_exclude)
          ? parsed.discover_exclude
          : DEFAULTS.discover_exclude,
        selected_models: normalizeSelectedModels(parsed.selected_models),
        operator: normalizeOperatorConfig(parsed.operator),
      };
    } else {
      _cached = { ...DEFAULTS };
    }
  } catch {
    _cached = { ...DEFAULTS };
  }

  return _cached;
}

export function saveSwitchbayConfig(config: SwitchbayConfig): void {
  const target = configPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(config, null, 2), "utf-8");
  _cached = config;
}

export function addWhitelistedLocation(location: string): SwitchbayConfig {
  const config = loadSwitchbayConfig();
  const resolved = resolveLocationInput(location);
  if (!config.locations.includes(resolved)) {
    config.locations = [...config.locations, resolved];
    saveSwitchbayConfig(config);
  }
  return config;
}

export function getSelectedRuntimeModel(lane: RuntimeLane): SelectedRuntimeModel | null {
  return loadSwitchbayConfig().selected_models[lane] ?? null;
}

export function setSelectedRuntimeModel(lane: RuntimeLane, model: SelectedRuntimeModel): SwitchbayConfig {
  const config = loadSwitchbayConfig();
  const next: SwitchbayConfig = {
    ...config,
    selected_models: {
      ...config.selected_models,
      [lane]: model,
    },
  };
  saveSwitchbayConfig(next);
  return next;
}

export function getOperatorConfig(): OperatorConfig {
  return applyOperatorEnv(loadSwitchbayConfig().operator);
}

export function resolveLocationInput(location: string): string {
  const unquoted = stripWrappingQuotes(location.trim());
  return path.resolve(unquoted.replace(/^~/, os.homedir()));
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function normalizeSelectedModels(value: unknown): Partial<Record<RuntimeLane, SelectedRuntimeModel>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<RuntimeLane, SelectedRuntimeModel>> = {};
  for (const lane of ["cloud", "cloud-mcp", "local", "local-mcp"] as RuntimeLane[]) {
    const raw = (value as Record<string, unknown>)[lane];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const id = String((raw as Record<string, unknown>).id ?? "").trim();
    if (!id) continue;
    const provider = String((raw as Record<string, unknown>).provider ?? "").trim();
    result[lane] = {
      id,
      provider: provider === "openai" || provider === "anthropic" || provider === "google" || provider === "lmstudio" || provider === "lmstudio-mcp" || provider === "ollama"
        ? provider
        : undefined,
    };
  }
  return result;
}

function normalizeOperatorConfig(value: unknown): OperatorConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULTS.operator };
  }
  const raw = value as Record<string, unknown>;
  return {
    enabled: normalizeBoolean(raw.enabled, DEFAULTS.operator.enabled),
    startupOverview: normalizeBoolean(raw.startupOverview, DEFAULTS.operator.startupOverview),
    dailyBoard: normalizeBoolean(raw.dailyBoard, DEFAULTS.operator.dailyBoard),
  };
}

function applyOperatorEnv(config: OperatorConfig): OperatorConfig {
  return {
    enabled: normalizeBooleanEnv(Bun.env.SWITCHBAY_OPERATOR, config.enabled),
    startupOverview: normalizeBooleanEnv(Bun.env.SWITCHBAY_STARTUP_OVERVIEW, config.startupOverview),
    dailyBoard: normalizeBooleanEnv(Bun.env.SWITCHBAY_DAILY_BOARD, config.dailyBoard),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeBooleanEnv(value, fallback);
  return fallback;
}

function normalizeBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

export function invalidateConfigCache(): void {
  _cached = null;
}
