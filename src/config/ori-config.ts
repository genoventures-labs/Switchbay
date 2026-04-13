import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".ori", "config.json");

export type OriConfig = {
  /** Explicit list of whitelisted locations ORI can travel to */
  locations: string[];
  /** If true, auto-discover git repos under home dir (depth-limited) */
  auto_discover: boolean;
  /** Directories to exclude from auto-discovery */
  discover_exclude: string[];
};

const DEFAULTS: OriConfig = {
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

let _cached: OriConfig | null = null;

/**
 * Load ~/.ori/config.json, merging with defaults.
 * Results are cached for the process lifetime.
 */
export function loadOriConfig(): OriConfig {
  if (_cached) return _cached;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<OriConfig>;
      _cached = {
        locations: Array.isArray(parsed.locations)
          ? parsed.locations.map((l) => path.resolve(l.replace(/^~/, os.homedir())))
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

/**
 * Persist a config update to ~/.ori/config.json.
 */
export function saveOriConfig(config: OriConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  _cached = config;
}

/**
 * Add a location to the whitelist and persist.
 */
export function addWhitelistedLocation(location: string): OriConfig {
  const config = loadOriConfig();
  const resolved = path.resolve(location.replace(/^~/, os.homedir()));
  if (!config.locations.includes(resolved)) {
    config.locations = [...config.locations, resolved];
    saveOriConfig(config);
  }
  return config;
}

/** Invalidate the config cache (useful in tests or after external edits). */
export function invalidateConfigCache(): void {
  _cached = null;
}
