import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { tryLocalCommand } from "../agent/commands";
import { buildTurn, executeTurn, extractAssistantText, synthesizeAssistantFallback } from "../agent/loop";
import { resolveAgentPolicy } from "../agent/policy";
import { createApprovalRequest, createInitialSessionState } from "../agent/turn-state";
import { getToolMode, normalizeRuntimeLane } from "../config/env";
import { clearSelectedRuntimeModel, getSelectedRuntimeModel, setSelectedRuntimeModel } from "../config/switchbay-config";
import { normalizeCloudProvider, setActiveCloudProvider } from "../runtime/cloud-providers";
import { createRuntimeClient } from "../runtime/client";
import { modelOptionForAddress, parseModelAddress } from "../runtime/model-identity";
import { normalizeLocalProvider, setActiveLocalProvider } from "../runtime/local-providers";
import { loadPersistedSession, savePersistedSession } from "../session/persistence";
import { loadWorkspaceSnapshot } from "../session/workspace";
import { saveTraceRecord } from "../trace/store";
import type { TurnRequest, TurnResponse } from "./types";

export async function runSwitchbayTurn(input: TurnRequest, options: { requestId?: string; signal?: AbortSignal; onToken?: (token: string) => void; onStep?: (step: string) => void } = {}): Promise<TurnResponse> {
  const requestId = options.requestId ?? crypto.randomUUID();
  const prompt = input.input?.trim();
  if (!prompt) throw new Error("input is required");

  const cwd = resolve(input.workspace?.trim() || process.cwd());
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`workspace is not a directory: ${cwd}`);

  const runtimeLane = normalizeRuntimeLane(input.lane);
  const toolMode = getToolMode();
  const localProvider = normalizeLocalProvider(input.lane);
  const cloudProvider = normalizeCloudProvider(input.lane);
  const selected = getSelectedRuntimeModel(runtimeLane);
  const addressed = parseModelAddress(prompt);
  const addressedModel = addressed ? modelOptionForAddress(addressed) : null;
  if (addressed?.auto) {
    clearSelectedRuntimeModel("cloud");
    clearSelectedRuntimeModel("cloud-mcp");
    setActiveCloudProvider("auto");
  } else if (addressed && addressedModel) {
    setSelectedRuntimeModel(addressedModel.lane, { id: addressedModel.id, provider: addressedModel.provider });
    if (addressed.provider) setActiveCloudProvider(addressed.provider);
    if (addressed.localProvider) setActiveLocalProvider(addressed.localProvider);
  }
  const effectiveRuntimeLane = addressed?.lane ?? runtimeLane;
  const client = addressed
    ? createRuntimeClient(addressed.lane, {
        model: addressedModel?.provider === "auto" ? undefined : addressedModel?.id,
        provider: addressed.provider,
        localProvider: addressed.localProvider ?? localProvider,
      })
    : createRuntimeClient(runtimeLane, selected
    ? {
        model: selected.id,
        provider: selected.provider === "openai" || selected.provider === "anthropic" || selected.provider === "google" ? selected.provider : cloudProvider === "openai" || cloudProvider === "anthropic" || cloudProvider === "google" ? cloudProvider : null,
        localProvider,
      }
    : {
        localProvider,
        provider: cloudProvider === "openai" || cloudProvider === "anthropic" || cloudProvider === "google" ? cloudProvider : null,
      });
  const workspace = await loadWorkspaceSnapshot(cwd);

  if (input.sessionId && !/^[A-Za-z0-9_-]{1,100}$/.test(input.sessionId)) throw new Error("invalid session id");
  let state = input.newSession || !input.sessionId ? null : await loadPersistedSession(input.sessionId);
  if (state && input.clientId && state.clientId !== input.clientId) throw new Error("session scope does not match clientId");
  if (state?.workspace?.cwd && state.workspace.cwd !== cwd) throw new Error("session scope does not match workspace");
  if (!state) {
    const policy = resolveAgentPolicy({ mode: input.mode ?? "build", profile: input.profile ?? "switchbay" });
    state = createInitialSessionState({
      mode: policy.mode,
      profile: input.profile ?? "switchbay",
      resolvedProfile: policy.runtimeProfile,
      surface: input.surface ?? "dev",
      clientId: input.clientId ?? "default",
    });
  }

  const localCommand = await tryLocalCommand(prompt, {
    client,
    profile: state.resolvedProfile,
    sessionId: state.sessionId,
    surface: state.surface,
    workspace,
    conversation: state.conversation,
    lastChangedFile: state.changedFiles[state.changedFiles.length - 1] ?? null,
    activeAgentId: state.activeAgentId,
    runtimeLane: effectiveRuntimeLane,
    toolMode,
  });

  if (localCommand.handled && localCommand.assistantMessage && !localCommand.followUpInput) {
    state.conversation.push({ role: "user", content: prompt }, { role: "assistant", content: localCommand.assistantMessage });
    state.currentObjective = prompt.slice(0, 100);
    state.workspace = workspace;
    state.updatedAt = Date.now();
    await savePersistedSession(state);
    return response(requestId, state.sessionId, localCommand.assistantMessage, runtimeLane, false, [], [], workspace, null, null);
  }

  const modelPrompt = localCommand.followUpInput ?? prompt;

  const turn = await buildTurn({
    input: modelPrompt,
    mode: state.mode,
    profile: state.requestedProfile,
    previousObjective: state.currentObjective,
    transcript: state.conversation,
    workspace,
    activeAgentId: state.activeAgentId,
    runtimeLane,
    toolMode,
  });
  const executedTurn = await executeTurn({ client, cwd, sessionId: state.sessionId, surface: state.surface, turn, workspace, signal: options.signal, onToken: options.onToken, onStep: options.onStep });
  const content = extractAssistantText(executedTurn.response) || synthesizeAssistantFallback(prompt, executedTurn.toolExecutions, workspace);
  const pendingShell = executedTurn.toolExecutions.find(item => item.shellPending)?.shellPending ?? null;
  if (pendingShell) {
    state.pendingShell = pendingShell;
    state.pendingApproval = createApprovalRequest({ kind: "shell_command", title: "Command approval", summary: pendingShell.reason, commandHint: pendingShell.command });
  }
  let traceSaved = false;
  if (content) {
    await saveTraceRecord({ assistantContent: content, cwd, executedTurn, runtimeLane: effectiveRuntimeLane, toolMode, sessionId: state.sessionId, turn, userPrompt: prompt, workspace });
    traceSaved = true;
  }

  state.conversation.push({ role: "user", content: prompt });
  if (content) state.conversation.push({ role: "assistant", content });
  state.currentObjective = turn.objective;
  state.workspace = workspace;
  state.changedFiles = [...new Set([...state.changedFiles, ...executedTurn.toolExecutions.map(item => item.changedFile).filter((file): file is string => Boolean(file))])];
  state.updatedAt = Date.now();
  await savePersistedSession(state);
  const meta = executedTurn.response.meta;
  return response(requestId, state.sessionId, content, effectiveRuntimeLane, traceSaved, turn.contextReceipt ?? [], executedTurn.toolExecutions, workspace, state.pendingApproval, meta ? { provider: meta.provider, model: meta.model, using: meta.using } : null, executedTurn.response.provider);
}

function response(requestId: string, sessionId: string, content: string, lane: TurnResponse["lane"], traceSaved: boolean, contextReceipt: string[], tools: Array<{ tool: string; summary: string; ok: boolean; changedFile?: string }>, workspace: TurnResponse["workspace"], pendingApproval: TurnResponse["pendingApproval"], route: TurnResponse["route"], provider = { events: [], citations: [], artifacts: [] } as NonNullable<import("../runtime/types").ChatCompletionResponse["provider"]>): TurnResponse {
  return { requestId, sessionId, content, lane, traceSaved, contextReceipt, toolExecutions: tools.map(({ tool, summary, ok, changedFile }) => ({ tool, summary, ok, changedFile })), providerEvents: provider.events, citations: provider.citations, artifacts: provider.artifacts, workspace, pendingApproval, route };
}
