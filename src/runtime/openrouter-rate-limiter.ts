import fs from "node:fs";
import path from "node:path";
import { userConfigPath } from "../config/paths";

const FILE = "openrouter-rate.json";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Configurable limits — override for paid tiers via env vars. */
const LIMIT_PER_MINUTE = Number(Bun.env.SWITCHBAY_OR_RPM ?? 20);
const LIMIT_PER_DAY    = Number(Bun.env.SWITCHBAY_OR_RPD ?? 50);

type RateState = { requests: number[] };

let cached: RateState | null = null;

function statePath(): string {
  return userConfigPath(FILE);
}

function load(): RateState {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf-8"));
    if (Array.isArray(raw?.requests)) {
      cached = { requests: raw.requests.filter((t: unknown) => typeof t === "number") };
      return cached;
    }
  } catch { /* first run or corrupt — start fresh */ }
  cached = { requests: [] };
  return cached;
}

function save(state: RateState): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state) + "\n", "utf-8");
  cached = state;
}

/** Prune timestamps outside the longest window we care about. */
function prune(requests: number[], now: number): number[] {
  return requests.filter((t) => now - t < DAY_MS);
}

export type RateLimitStatus = {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
  /** ms until the oldest in-minute request falls out of the window, or 0 if not throttled */
  waitMs: number;
  blocked: boolean;
  reason?: string;
};

export function getOpenRouterRateStatus(): RateLimitStatus {
  const now = Date.now();
  const state = load();
  const active = prune(state.requests, now);
  const inMinute = active.filter((t) => now - t < MINUTE_MS);
  const inDay    = active;

  const minuteBlocked = inMinute.length >= LIMIT_PER_MINUTE;
  const dayBlocked    = inDay.length    >= LIMIT_PER_DAY;

  let waitMs = 0;
  let reason: string | undefined;

  if (minuteBlocked) {
    const oldest = inMinute[0]!;
    waitMs = MINUTE_MS - (now - oldest);
    reason = `OpenRouter rate limit: ${inMinute.length}/${LIMIT_PER_MINUTE} requests this minute. Try again in ${Math.ceil(waitMs / 1000)}s.`;
  } else if (dayBlocked) {
    const oldest = inDay[0]!;
    waitMs = DAY_MS - (now - oldest);
    const h = Math.floor(waitMs / 3_600_000);
    const m = Math.ceil((waitMs % 3_600_000) / 60_000);
    reason = `OpenRouter rate limit: ${inDay.length}/${LIMIT_PER_DAY} requests today. Resets in ${h}h ${m}m.`;
  }

  return {
    minuteUsed: inMinute.length,
    minuteLimit: LIMIT_PER_MINUTE,
    dayUsed: inDay.length,
    dayLimit: LIMIT_PER_DAY,
    waitMs: Math.max(0, waitMs),
    blocked: minuteBlocked || dayBlocked,
    reason,
  };
}

/**
 * Record one request. Call this immediately before the network call succeeds.
 * Throws a descriptive error if either rate limit would be exceeded.
 */
export function recordOpenRouterRequest(): void {
  const status = getOpenRouterRateStatus();
  if (status.blocked) {
    throw new Error(status.reason!);
  }
  const now = Date.now();
  const state = load();
  const next: RateState = { requests: [...prune(state.requests, now), now] };
  save(next);
}

/** Returns true when usage is at or above the given threshold (0–1) for either window. */
export function isOpenRouterNearLimit(threshold = 0.8): boolean {
  const s = getOpenRouterRateStatus();
  return (s.minuteUsed / s.minuteLimit >= threshold) || (s.dayUsed / s.dayLimit >= threshold);
}

export function resetOpenRouterRateState(): void {
  cached = null;
  try { fs.unlinkSync(statePath()); } catch { /* already gone */ }
}
