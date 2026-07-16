import type { TraceRecord } from "../trace/store";

export type ModelPrice = { input: number; output: number; source: "builtin" | "override" | "local" };
export type CostEstimate = { usd: number; pricedTurns: number; unpricedTurns: number; totalTurns: number };

const BUILTIN_PRICES: Array<{ provider: string; pattern: RegExp; input: number; output: number }> = [
  { provider: "openai", pattern: /^gpt-5\.4-mini(?:-|$)/i, input: 0.75, output: 4.5 },
  { provider: "openai", pattern: /^gpt-5\.4-nano(?:-|$)/i, input: 0.2, output: 1.25 },
  { provider: "openai", pattern: /^gpt-5\.4(?:-|$)/i, input: 2.5, output: 15 },
  { provider: "anthropic", pattern: /^claude-sonnet-4-(?:5|6)(?:-|$)/i, input: 3, output: 15 },
  { provider: "anthropic", pattern: /^claude-haiku-4-5(?:-|$)/i, input: 1, output: 5 },
  { provider: "anthropic", pattern: /^claude-opus-4-1(?:-|$)/i, input: 15, output: 75 },
  { provider: "anthropic", pattern: /^claude-opus-4-6(?:-|$)/i, input: 5, output: 25 },
  { provider: "google", pattern: /^gemini-3\.5-flash(?:-|$)/i, input: 1.5, output: 9 },
  { provider: "google", pattern: /^gemini-3\.1-pro(?:-|$)/i, input: 2, output: 12 },
  { provider: "google", pattern: /^gemini-3-flash(?:-|$)/i, input: 0.5, output: 3 },
  { provider: "google", pattern: /^gemini-3\.1-flash-lite(?:-|$)/i, input: 0.25, output: 1.5 },
  { provider: "google", pattern: /^gemini-2\.5-flash(?:-|$)/i, input: 0.3, output: 2.5 },
];

export function modelPrice(provider?: string | null, model?: string | null): ModelPrice | null {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = String(model ?? "").trim();
  if (normalizedProvider === "ollama" || provider === "local") return { input: 0, output: 0, source: "local" };
  const override = pricingOverrides()[normalizedModel] ?? pricingOverrides()[`${normalizedProvider}/${normalizedModel}`];
  if (override) return { ...override, source: "override" };
  const match = BUILTIN_PRICES.find((price) => price.provider === normalizedProvider && price.pattern.test(normalizedModel));
  return match ? { input: match.input, output: match.output, source: "builtin" } : null;
}

export function estimateTraceCost(record: TraceRecord): number | null {
  const price = modelPrice(record.runtime.provider ?? record.runtime.lane, record.runtime.model);
  if (!price) return null;
  return (record.context.estimatedPromptTokens * price.input + record.result.estimatedAnswerTokens * price.output) / 1_000_000;
}

export function estimateCost(records: TraceRecord[]): CostEstimate {
  let usd = 0;
  let pricedTurns = 0;
  for (const record of records) {
    const cost = estimateTraceCost(record);
    if (cost == null) continue;
    usd += cost;
    pricedTurns += 1;
  }
  return { usd, pricedTurns, unpricedTurns: records.length - pricedTurns, totalTurns: records.length };
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function normalizeProvider(provider?: string | null): string {
  if (provider === "gemini") return "google";
  return String(provider ?? "").toLowerCase();
}

function pricingOverrides(): Record<string, { input: number; output: number }> {
  const raw = Bun.env.SWITCHBAY_MODEL_PRICING_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      const input = Number(value?.input); const output = Number(value?.output);
      return Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? [[key, { input, output }]] : [];
    }));
  } catch { return {}; }
}
