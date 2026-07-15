import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { traceDir, type TraceRecord } from "../trace/store";
import { barChart, flowGraph, sparkline } from "../tui/charts/text";
import { estimateCost, estimateTraceCost, formatUsd } from "./cost";

export async function listTraceRecords(cwd = process.cwd(), limit = Number.POSITIVE_INFINITY): Promise<TraceRecord[]> {
  const root = path.dirname(traceDir(cwd));
  const records: TraceRecord[] = [];
  try {
    for (const session of await readdir(root, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const dir = path.join(root, session.name);
      for (const file of await readdir(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const record = JSON.parse(await readFile(path.join(dir, file), "utf8")) as TraceRecord;
          if (record.version === 1 && !Number.isNaN(Date.parse(record.createdAt))) records.push(record);
        } catch {}
      }
    }
  } catch {}
  return records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

export function formatUsage(records: TraceRecord[], now = new Date()): string {
  if (!records.length) return "Switchbay Usage\n\nNo traced model turns in this workspace yet.";
  const prompt = records.reduce((sum, record) => sum + record.context.estimatedPromptTokens, 0);
  const answer = records.reduce((sum, record) => sum + record.result.estimatedAnswerTokens, 0);
  const tools = records.flatMap(record => record.actions.tools);
  const routes = new Map<string, number>();
  for (const record of records) {
    const route = record.runtime.provider ?? record.runtime.lane;
    routes.set(route, (routes.get(route) ?? 0) + 1);
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return records.filter(record => record.createdAt.slice(0, 10) === key).length;
  });
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 6);
  const todayRecords = records.filter(record => Date.parse(record.createdAt) >= startToday.getTime());
  const weekRecords = records.filter(record => Date.parse(record.createdAt) >= startWeek.getTime());
  const latestSessionId = records[0]?.sessionId;
  const sessionRecords = records.filter(record => record.sessionId === latestSessionId);
  const costs = {
    session: estimateCost(sessionRecords), today: estimateCost(todayRecords), week: estimateCost(weekRecords), lifetime: estimateCost(records),
  };
  const spendDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startWeek); date.setDate(startWeek.getDate() + index);
    const next = new Date(date); next.setDate(date.getDate() + 1);
    return estimateCost(records.filter(record => {
      const when = Date.parse(record.createdAt); return when >= date.getTime() && when < next.getTime();
    })).usd;
  });
  const providerCosts = new Map<string, number>();
  for (const record of records) {
    const cost = estimateTraceCost(record);
    if (cost == null) continue;
    const route = record.runtime.provider ?? record.runtime.lane;
    providerCosts.set(route, (providerCosts.get(route) ?? 0) + cost);
  }
  const coverage = costs.lifetime.unpricedTurns ? ` · ${costs.lifetime.unpricedTurns} unpriced` : " · all traced turns priced";
  return [
    "Switchbay Usage · trace estimates",
    "",
    `Turns     ${sparkline(days)}  ${records.length}`,
    `Tokens    prompt ${prompt.toLocaleString()} · answer ${answer.toLocaleString()} · total ${(prompt + answer).toLocaleString()}`,
    `Tools     ${tools.length} calls · ${tools.filter(tool => !tool.ok).length} failed`,
    `Files     ${new Set(records.flatMap(record => record.actions.changedFiles)).size} unique changed`,
    `Approvals ${records.reduce((sum, record) => sum + record.actions.pendingApprovals.length, 0)} pending events`,
    "",
    "Estimated API spend",
    `Session   ${formatUsd(costs.session.usd).padStart(9)}  ${sessionRecords.length} turns`,
    `Today     ${formatUsd(costs.today.usd).padStart(9)}  ${todayRecords.length} turns`,
    `7 days    ${formatUsd(costs.week.usd).padStart(9)}  ${weekRecords.length} turns`,
    `Lifetime  ${formatUsd(costs.lifetime.usd).padStart(9)}  ${records.length} turns${coverage}`,
    `Spend     ${sparkline(spendDays)}  last 7 days`,
    "",
    "Spend by provider",
    moneyBars([...providerCosts].map(([label, value]) => ({ label, value }))),
    "",
    "Routes",
    barChart([...routes].map(([label, value]) => ({ label, value }))),
    "",
    "Note: token counts and spend are estimates from trace text and standard API list prices.",
    "Excludes caching, reasoning not present in traces, tool/search fees, taxes, discounts, and local electricity.",
    "Override custom rates with SWITCHBAY_MODEL_PRICING_JSON (USD per 1M input/output tokens).",
  ].join("\n");
}

export function formatTraceGraph(record: TraceRecord | null): string {
  if (!record) return "Trace Graph\n\nNo trace exists yet. Complete a model turn first.";
  const shownTools = record.actions.tools.slice(0, 8);
  const nodes = [
    { label: "Prompt", detail: `${record.context.estimatedPromptTokens} estimated tokens` },
    { label: "Context", detail: `${record.context.knowledgeSources.length} knowledge sources` },
    { label: "Model", detail: `${record.runtime.provider ?? record.runtime.lane}/${record.runtime.model ?? "unknown"}` },
    ...shownTools.map(tool => ({ label: tool.tool, detail: clip(tool.summary, 64), tone: tool.ok ? "ok" as const : "error" as const })),
    ...(record.actions.tools.length > 8 ? [{ label: `${record.actions.tools.length - 8} more tool steps`, tone: "warning" as const }] : []),
    ...(record.actions.pendingApprovals.length ? [{ label: "Approval pending", detail: `${record.actions.pendingApprovals.length} command(s)`, tone: "warning" as const }] : []),
    { label: "Answer", detail: `${record.result.estimatedAnswerTokens} estimated tokens · ${record.result.finishReason ?? "unknown finish"}`, tone: "ok" as const },
  ];
  return ["Trace Graph · latest turn", "", flowGraph(nodes)].join("\n");
}

function clip(value: string, limit: number): string { return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`; }

function moneyBars(rows: Array<{ label: string; value: number }>, width = 22): string {
  if (!rows.length) return "No priced cloud turns.";
  const max = Math.max(...rows.map(row => row.value), 0.000001);
  const labelWidth = Math.max(...rows.map(row => row.label.length));
  return rows.map(row => {
    const size = row.value <= 0 ? 0 : Math.max(1, Math.round((row.value / max) * width));
    return `${row.label.padEnd(labelWidth)}  ${"█".repeat(size)}${"░".repeat(width - size)}  ${formatUsd(row.value)}`;
  }).join("\n");
}
