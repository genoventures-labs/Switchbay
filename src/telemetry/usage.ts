import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { traceDir, type TraceRecord } from "../trace/store";
import { barChart, flowGraph, sparkline } from "../tui/charts/text";

export async function listTraceRecords(cwd = process.cwd(), limit = 200): Promise<TraceRecord[]> {
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
  return [
    "Switchbay Usage · trace estimates",
    "",
    `Turns     ${sparkline(days)}  ${records.length}`,
    `Tokens    prompt ${prompt.toLocaleString()} · answer ${answer.toLocaleString()} · total ${(prompt + answer).toLocaleString()}`,
    `Tools     ${tools.length} calls · ${tools.filter(tool => !tool.ok).length} failed`,
    `Files     ${new Set(records.flatMap(record => record.actions.changedFiles)).size} unique changed`,
    `Approvals ${records.reduce((sum, record) => sum + record.actions.pendingApprovals.length, 0)} pending events`,
    "",
    "Routes",
    barChart([...routes].map(([label, value]) => ({ label, value }))),
    "",
    "Note: tokens are estimates; cost and latency are not recorded yet.",
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
