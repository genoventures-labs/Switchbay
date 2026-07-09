import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { userConfigPath } from "./paths";

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

export function invalidateConfigCache(): void {
  _cached = null;
}
