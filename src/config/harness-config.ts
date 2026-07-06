import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".code-harness", "config.json");
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".ori", "config.json");

export type HarnessConfig = {
  /** Explicit list of whitelisted locations the harness can travel to. */
  locations: string[];
  /** If true, auto-discover git repos under home dir (depth-limited). */
  auto_discover: boolean;
  /** Directories to exclude from auto-discovery. */
  discover_exclude: string[];
};

const DEFAULTS: HarnessConfig = {
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

let _cached: HarnessConfig | null = null;

export function loadHarnessConfig(): HarnessConfig {
  if (_cached) return _cached;

  const configPath = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : LEGACY_CONFIG_PATH;
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<HarnessConfig>;
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

export function saveHarnessConfig(config: HarnessConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  _cached = config;
}

export function addWhitelistedLocation(location: string): HarnessConfig {
  const config = loadHarnessConfig();
  const resolved = path.resolve(location.replace(/^~/, os.homedir()));
  if (!config.locations.includes(resolved)) {
    config.locations = [...config.locations, resolved];
    saveHarnessConfig(config);
  }
  return config;
}

export function invalidateConfigCache(): void {
  _cached = null;
}
