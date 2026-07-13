import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceDataPath } from "../config/paths";
import type { BuiltTurn, ExecutedTurn } from "../agent/loop";
import type { AgentToolExecution } from "../agent/tools";
import type { RuntimeLane, ToolMode } from "../config/env";
import type { WorkspaceSnapshot } from "../session/workspace";

export type TraceToolExecution = {
  tool: string;
  ok: boolean;
  summary: string;
  bodyPreview: string;
  bodyLength: number;
  changedFile?: string;
  shellPending?: {
    command: string;
    reason: string;
  };
};

export type TraceRecord = {
  version: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  objective: string;
  userPrompt: string;
  runtime: {
    lane: RuntimeLane;
    toolMode: ToolMode;
    model?: string | null;
    provider?: string | null;
  };
  workspace: {
    cwd: string;
    repoRoot?: string | null;
    branch?: string | null;
    dirtyFiles: string[];
  };
  context: {
    knowledgeSources: string[];
    systemPromptChars: number;
    promptChars: number;
    estimatedPromptTokens: number;
  };
  actions: {
    toolCount: number;
    tools: TraceToolExecution[];
    changedFiles: string[];
    pendingApprovals: TraceToolExecution["shellPending"][];
  };
  result: {
    finalAnswer: string;
    finalAnswerChars: number;
    estimatedAnswerTokens: number;
    finishReason?: string | null;
  };
};

export function traceDir(cwd = process.cwd(), sessionId = "default"): string {
  return workspaceDataPath(cwd, path.join("traces", sessionId));
}

export function latestTracePath(cwd = process.cwd()): string {
  return workspaceDataPath(cwd, path.join("traces", "latest.json"));
}

export async function saveTraceRecord(input: {
  assistantContent: string;
  cwd: string;
  executedTurn: ExecutedTurn;
  runtimeLane: RuntimeLane;
  toolMode: ToolMode;
  sessionId: string;
  turn: BuiltTurn;
  userPrompt: string;
  workspace: WorkspaceSnapshot | null;
}): Promise<TraceRecord> {
  const now = new Date();
  const id = `${now.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const systemPrompt = String(input.turn.request.messages.find((message) => message.role === "system")?.content ?? "");
  const promptChars = input.turn.request.messages.reduce((sum, message) => sum + JSON.stringify(message.content ?? "").length, 0);
  const tools = input.executedTurn.toolExecutions.map(toTraceToolExecution);
  const changedFiles = Array.from(new Set(tools.map((tool) => tool.changedFile).filter(Boolean) as string[]));
  const pendingApprovals = tools.map((tool) => tool.shellPending).filter(Boolean) as NonNullable<TraceToolExecution["shellPending"]>[];

  const record: TraceRecord = {
    version: 1,
    id,
    sessionId: input.sessionId,
    createdAt: now.toISOString(),
    objective: input.turn.objective,
    userPrompt: input.userPrompt,
    runtime: {
      lane: input.runtimeLane,
      toolMode: input.toolMode,
      model: input.executedTurn.response.meta?.model ?? input.turn.request.model ?? null,
      provider: input.executedTurn.response.meta?.provider ?? null,
    },
    workspace: {
      cwd: input.workspace?.cwd ?? input.cwd,
      repoRoot: input.workspace?.repoRoot ?? null,
      branch: input.workspace?.branch ?? null,
      dirtyFiles: input.workspace?.dirtyFiles ?? [],
    },
    context: {
      knowledgeSources: extractKnowledgeSources(systemPrompt),
      systemPromptChars: systemPrompt.length,
      promptChars,
      estimatedPromptTokens: estimateTokens(systemPrompt) + estimateTokens(String(input.userPrompt)),
    },
    actions: {
      toolCount: tools.length,
      tools,
      changedFiles,
      pendingApprovals,
    },
    result: {
      finalAnswer: input.assistantContent,
      finalAnswerChars: input.assistantContent.length,
      estimatedAnswerTokens: estimateTokens(input.assistantContent),
      finishReason: input.executedTurn.response.choices?.[0]?.finish_reason ?? null,
    },
  };

  const dir = traceDir(input.cwd, input.sessionId);
  await mkdir(dir, { recursive: true });
  const recordPath = path.join(dir, `${id}.json`);
  await writeFile(recordPath, JSON.stringify(record, null, 2), "utf-8");
  await writeFile(latestTracePath(input.cwd), JSON.stringify({ path: recordPath, id, sessionId: input.sessionId }, null, 2), "utf-8");
  return record;
}

export async function loadLatestTrace(cwd = process.cwd()): Promise<{ path: string; record: TraceRecord } | null> {
  const latest = latestTracePath(cwd);
  if (!existsSync(latest)) return null;

  try {
    const pointer = JSON.parse(await readFile(latest, "utf-8")) as { path?: string };
    if (!pointer.path || !existsSync(pointer.path)) return null;
    const record = JSON.parse(await readFile(pointer.path, "utf-8")) as TraceRecord;
    return { path: pointer.path, record };
  } catch {
    return null;
  }
}

export async function describeLatestTrace(cwd = process.cwd()): Promise<string> {
  const latest = await loadLatestTrace(cwd);
  if (!latest) {
    return [
      "**Trace Ledger**",
      "",
      `Latest: \`${latestTracePath(cwd)}\` (not created yet)`,
      "",
      "Complete a model turn to write the first trace.",
    ].join("\n");
  }

  const { path: tracePath, record } = latest;
  const lines = [
    "**Trace Ledger: Latest Turn**",
    "",
    `Trace: \`${tracePath}\``,
    `When: \`${record.createdAt}\``,
    `Objective: ${record.objective}`,
    `Runtime: \`${record.runtime.lane}\` / \`${record.runtime.toolMode}\``,
    `Workspace: \`${record.workspace.cwd}\`${record.workspace.branch ? ` on \`${record.workspace.branch}\`` : ""}`,
    `Knowledge sources: \`${record.context.knowledgeSources.length}\``,
    `Tools: \`${record.actions.toolCount}\``,
    `Changed files: \`${record.actions.changedFiles.length}\``,
    `Pending approvals: \`${record.actions.pendingApprovals.length}\``,
    `Prompt estimate: \`${record.context.estimatedPromptTokens}\` tokens`,
    `Answer estimate: \`${record.result.estimatedAnswerTokens}\` tokens`,
  ];

  if (record.context.knowledgeSources.length) {
    lines.push("", "Knowledge:", ...record.context.knowledgeSources.slice(0, 6).map((source) => `- \`${source}\``));
  }

  if (record.actions.tools.length) {
    lines.push("", "Tools:", ...record.actions.tools.slice(0, 8).map((tool) => `- ${tool.ok ? "ok" : "x"} \`${tool.tool}\`: ${tool.summary}`));
  }

  return lines.join("\n");
}

export async function latestTraceExportPath(cwd = process.cwd()): Promise<string | null> {
  const latest = await loadLatestTrace(cwd);
  return latest?.path ?? null;
}

function toTraceToolExecution(tool: AgentToolExecution): TraceToolExecution {
  return {
    tool: tool.tool,
    ok: tool.ok,
    summary: tool.summary,
    bodyPreview: trim(tool.body, 1600),
    bodyLength: tool.body.length,
    changedFile: tool.changedFile,
    shellPending: tool.shellPending,
  };
}

function extractKnowledgeSources(systemPrompt: string): string[] {
  const sources: string[] = [];
  const pattern = /^Source \d+: ([^\n]+)$/gm;
  let match = pattern.exec(systemPrompt);
  while (match) {
    if (match[1]) sources.push(match[1].trim());
    match = pattern.exec(systemPrompt);
  }
  return sources;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.round(value.length / 4));
}

function trim(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}\n...`;
}
