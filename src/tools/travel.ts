import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadHarnessConfig } from "../config/harness-config";
import { loadWorkspaceSnapshot } from "../session/workspace";

export type TravelLocation = {
  /** Absolute path to the location */
  absPath: string;
  /** Display name (basename or relative-from-home) */
  label: string;
  /** Whether it's a git repo */
  isGit: boolean;
  /** Source: explicit whitelist or auto-discovered */
  source: "whitelist" | "discovered";
};

const DISCOVER_MAX_DEPTH = 4;

/**
 * Build the full list of locations the harness can travel to:
 * explicit whitelist + auto-discovered git repos under home dir.
 */
export async function listTravelLocations(): Promise<TravelLocation[]> {
  const config = loadHarnessConfig();
  const seen = new Set<string>();
  const results: TravelLocation[] = [];

  // Explicit whitelist first
  for (const loc of config.locations) {
    if (seen.has(loc)) continue;
    seen.add(loc);
    if (fs.existsSync(loc)) {
      results.push(makeLocation(loc, "whitelist"));
    }
  }

  // Auto-discover git repos under home dir
  if (config.auto_discover) {
    const home = os.homedir();
    await discoverGitRepos(home, config.discover_exclude, seen, results, 0);
  }

  return results;
}

/**
 * Fuzzy-match a query against available travel locations.
 * Returns ranked candidates (best match first).
 */
export async function fuzzyMatchLocations(query: string): Promise<TravelLocation[]> {
  const all = await listTravelLocations();
  const lower = query.toLowerCase();

  const scored = all.map((loc) => {
    const label = loc.label.toLowerCase();
    const abs = loc.absPath.toLowerCase();

    let score = 0;
    if (label === lower || abs === lower) score = 100;
    else if (label.startsWith(lower) || path.basename(abs).startsWith(lower)) score = 80;
    else if (label.includes(lower) || abs.includes(lower)) score = 60;
    else {
      // character-level subsequence match
      let qi = 0;
      for (let i = 0; i < label.length && qi < lower.length; i++) {
        if (label[i] === lower[qi]) qi++;
      }
      if (qi === lower.length) score = 30 + qi;
    }

    return { loc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.loc);
}

export type TravelResult = {
  ok: boolean;
  location?: TravelLocation;
  previousCwd?: string;
  error?: string;
  workspace?: Awaited<ReturnType<typeof loadWorkspaceSnapshot>>;
};

/**
 * Travel to a location: validate it's whitelisted, chdir, reload workspace.
 * Returns the new workspace snapshot on success.
 */
export async function travelTo(absPath: string): Promise<TravelResult> {
  const config = loadHarnessConfig();
  const all = await listTravelLocations();

  const target = all.find((l) => l.absPath === absPath);
  if (!target) {
    // Check if it's at least on the whitelist or discovered
    const isAllowed =
      config.locations.includes(absPath) ||
      all.some((l) => l.absPath === absPath);

    if (!isAllowed) {
      return {
        ok: false,
        error: `Location not whitelisted: ${absPath}. Add it to ~/.code-harness/config.json or enable auto_discover.`,
      };
    }
  }

  if (!fs.existsSync(absPath)) {
    return { ok: false, error: `Path does not exist: ${absPath}` };
  }

  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) {
    return { ok: false, error: `Path is not a directory: ${absPath}` };
  }

  const previousCwd = process.cwd();

  try {
    process.chdir(absPath);
  } catch (err) {
    return {
      ok: false,
      error: `chdir failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const workspace = await loadWorkspaceSnapshot(absPath);
    return {
      ok: true,
      location: target ?? makeLocation(absPath, "whitelist"),
      previousCwd,
      workspace,
    };
  } catch {
    // workspace load failure is non-fatal — we still traveled
    return {
      ok: true,
      location: target ?? makeLocation(absPath, "whitelist"),
      previousCwd,
    };
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function makeLocation(absPath: string, source: TravelLocation["source"]): TravelLocation {
  const home = os.homedir();
  const label = absPath.startsWith(home)
    ? "~" + absPath.slice(home.length)
    : absPath;
  const isGit = fs.existsSync(path.join(absPath, ".git"));
  return { absPath, label, isGit, source };
}

async function discoverGitRepos(
  dir: string,
  exclude: string[],
  seen: Set<string>,
  out: TravelLocation[],
  depth: number,
): Promise<void> {
  if (depth > DISCOVER_MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (exclude.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (seen.has(fullPath)) continue;

    const isGit = fs.existsSync(path.join(fullPath, ".git"));
    if (isGit) {
      seen.add(fullPath);
      out.push(makeLocation(fullPath, "discovered"));
      // Don't recurse into git repos — sub-repos are rare and noisy
      continue;
    }

    await discoverGitRepos(fullPath, exclude, seen, out, depth + 1);
  }
}
