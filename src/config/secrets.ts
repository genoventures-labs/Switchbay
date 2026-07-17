import fs from "node:fs";
import path from "node:path";
import { userConfigDir } from "./paths";

export function readConfiguredSecret(...names: string[]): string | undefined {
  for (const name of names) {
    const direct = Bun.env[name]?.trim();
    if (direct) return direct;
  }

  if (Bun.env.SWITCHBAY_IGNORE_SERVICE_ENV === "1") return undefined;

  const values = readServiceEnvironment();
  for (const name of names) {
    const value = values.get(name)?.trim();
    if (value) return value;
  }

  // Fall through to shell rc files — picks up keys exported in ~/.zshrc, ~/.bashrc, etc.
  // that aren't in the current process environment (e.g. when running as a service).
  const shellValues = readShellEnvironment();
  for (const name of names) {
    const value = shellValues.get(name)?.trim();
    if (value) return value;
  }

  return undefined;
}

/**
 * Parse shell rc files and dotenv files for exported key=value pairs.
 * Returns a Map of every key found, sourced from the files in priority order.
 * Results are cached per process lifetime since rc files don't change at runtime.
 */
let shellEnvCache: Map<string, string> | null = null;

export function readShellEnvironment(): Map<string, string> {
  if (shellEnvCache) return shellEnvCache;
  const result = new Map<string, string>();
  const home = Bun.env.HOME ?? process.env.HOME ?? "";
  if (!home) {
    shellEnvCache = result;
    return result;
  }

  // Files checked in order — later entries override earlier ones
  const candidates = [
    path.join(home, ".profile"),
    path.join(home, ".bash_profile"),
    path.join(home, ".bashrc"),
    path.join(home, ".zprofile"),
    path.join(home, ".zshrc"),
    path.join(home, ".config", "fish", "config.fish"),
    path.join(home, ".env"),
    path.join(home, ".envrc"),
  ];

  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      for (const line of content.split("\n")) {
        // Match: export KEY=value  or  KEY=value  or  set -x KEY value (fish)
        const match =
          line.match(/^\s*export\s+([A-Z][A-Z0-9_]*)=(.*)$/) ??
          line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/) ??
          line.match(/^\s*set\s+(?:-[gxlU]+\s+)*([A-Z][A-Z0-9_]*)\s+(.+)$/);
        if (!match?.[1]) continue;
        const key = match[1];
        const val = unquote(match[2] ?? "");
        // Only capture non-empty values that look like real secrets (not path entries, etc.)
        if (val && !val.includes(":") && !val.startsWith("/") && val.length > 4) {
          result.set(key, val);
        }
      }
    } catch { /* file not found or not readable — skip */ }
  }

  shellEnvCache = result;
  return result;
}

/** Invalidate the shell env cache (useful after a key is written or tests). */
export function invalidateShellEnvCache(): void {
  shellEnvCache = null;
}

function readServiceEnvironment(): Map<string, string> {
  const result = new Map<string, string>();
  const target = path.join(userConfigDir(), "service", ".env");
  try {
    for (const line of fs.readFileSync(target, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (!match?.[1]) continue;
      result.set(match[1], unquote(match[2] ?? ""));
    }
  } catch {}
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}
