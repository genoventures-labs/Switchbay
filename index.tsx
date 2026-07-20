import React from "react";
import { render } from "ink";
import { parseCliArgs } from "./src/cli/args";
import { createRuntimeClient, getRuntimeLaneLabel } from "./src/runtime/client";
import { getToolMode, normalizeRuntimeLane } from "./src/config/env";
import { DEFAULTS } from "./src/config/defaults";
import { SwitchbayApp } from "./src/tui/app";
import { clearSelectedRuntimeModel, getSelectedRuntimeModel, loadSwitchbayConfig, setSelectedRuntimeModel } from "./src/config/switchbay-config";
import { getLocalMode, setLocalMode, type LocalMode } from "./src/config/local-mode";
import { fuzzyMatchLocations, travelTo } from "./src/tools/travel";
import { listSessions, purgeSessions, loadPersistedSession, savePersistedSession } from "./src/session/persistence";
import { buildTurn, executeTurn, extractAssistantText, refreshWorkspace, synthesizeAssistantFallback } from "./src/agent/loop";
import { tryLocalCommand } from "./src/agent/commands";
import { describeEngineBay, loadEngineBayInventory, syncEngineBayRepo, syncEngineBayWithDiff } from "./src/engines/hub";
import { healthCheckEngines, fixEngines } from "./src/engines/health";
import { describeToolbox, loadToolboxInventory, readToolboxSkill, syncToolboxWithDiff } from "./src/toolbox/hub";
import { addMemoryNote, describeMemory, listMemoryNotes, readMemoryFacts, refreshMemory } from "./src/memory/store";
import { describeKnowledgeIndex, formatKnowledgeSearchResults, refreshKnowledgeIndex, searchKnowledgeIndex } from "./src/knowledge/store";
import { describeLatestTrace, latestTraceExportPath, saveTraceRecord } from "./src/trace/store";
import { loadLatestTrace } from "./src/trace/store";
import { formatTraceGraph, formatUsage, listTraceRecords } from "./src/telemetry/usage";
import { createDefaultSwitchbayMcpConfig, describeSwitchbayMcpConfig, loadSwitchbayMcpConfig, saveSwitchbayMcpConfig } from "./src/runtime/mcp-config";
import { describeTrustedMcpCatalog } from "./src/runtime/mcp-catalog";
import { ANSI_COLORS as CLR } from "./src/tui/theme";
import { describePlugins, loadPluginInventory, readPlugin } from "./src/plugins/registry";
import { getCloudModelPresets, listRuntimeModels, type RuntimeModelOption } from "./src/runtime/models";
import { getActiveLocalProvider, loadLocalProvidersConfig, normalizeLocalProvider, setActiveLocalProvider, type LocalProviderId } from "./src/runtime/local-providers";
import { formatRouteTag } from "./src/runtime/route-display";
import { getActiveCloudProvider, listAutoModelPool, loadCloudProvidersConfig, normalizeCloudProvider, setActiveCloudProvider } from "./src/runtime/cloud-providers";
import { addDailyTask, clearDailyBoard, completeDailyTask, describeDailyBoard } from "./src/operator/daily-board";
import { formatFrictionRadar, runFrictionRadar } from "./src/operator/radar";
import { buildQuickHandoff } from "./src/operator/handoff";
import { addCloudModel, clearCloudModelCatalog, inferCloudModelProvider, loadCloudModelCatalog, removeCloudModel, removeCloudModelsByProvider, reverifyCloudModel, verifyCloudModel } from "./src/runtime/cloud-model-catalog";
import type { CloudProviderId } from "./src/runtime/cloud-providers";
import { findAgent, loadAllAgents, saveAgentDefinition, type AgentScope } from "./src/agent/agents";
import { loadEngineRegistry } from "./src/engines/registry";
import { renderCliList } from "./src/cli/list-output";
import { cliColorEnabled, cliFailure, cliPage, cliReceipt, cleanTerminalText } from "./src/cli/presentation";
import { renderCliHelp, renderSubcommandHelp } from "./src/cli/help";
import { confirm } from "./src/cli/confirm";
import { createCanvasDoc, editCanvasDoc, listCanvasDocs } from "./src/tools/canvas";
import { runBenchmark, runPreBench, type BenchmarkResult } from "./src/benchmark/runner";
import { getAllGrades, getModelGrade, isTrusted, saveModelGrade } from "./src/benchmark/grades";
import { addImageToStore, listImages, formatImageSize } from "./src/runtime/image-store";
import { clearSessionSkills } from "./src/toolbox/hub";

// Ensure config is initialized on first boot
loadSwitchbayConfig();

let options: ReturnType<typeof parseCliArgs>;
try {
  options = parseCliArgs(process.argv);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(cliFailure("Command Center", message, ["switchbay --help"]));
  process.exit(1);
}

async function boot() {
  if (options.subcommand === "help") {
    console.log(options.helpContext ? renderSubcommandHelp(options.helpContext) : renderCliHelp());
    return;
  }

  if (options.subcommand === "open") {
    const { openSwitchbayWorkspace } = await import("./src/web/launcher");
    console.log(await openSwitchbayWorkspace());
    return;
  }

  if (options.subcommand === "web-serve") {
    const { startWebWorkspaceServer } = await import("./src/web/server");
    const server = startWebWorkspaceServer();
    console.log(`Switchbay workspace listening on http://${server.hostname}:${server.port}`);
    return;
  }

  if (options.subcommand === "serve") {
    const port = Number(Bun.env.SWITCHBAY_API_PORT ?? 7349);
    const host = Bun.env.SWITCHBAY_API_HOST ?? "127.0.0.1";

    // Fast port check in foreground
    try {
      const net = require("node:net");
      await new Promise<void>((resolve, reject) => {
        const testServer = net.createServer();
        testServer.once("error", reject);
        testServer.once("listening", () => {
          testServer.close();
          resolve();
        });
        testServer.listen(port, host);
      });
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.error(`\n${CLR.error}Error: Port is already in use.${CLR.reset}`);
        console.error("The Switchbay background service or another instance is likely already running.");
        console.error("You can:");
        console.error("  1. Check service status:   switchbay service status");
        console.error("  2. Uninstall the service:  switchbay service uninstall");
        console.error("  3. Run on another port:    SWITCHBAY_API_PORT=7350 switchbay serve\n");
        process.exit(1);
      }
    }

    if (options.detach) {
      const bin = process.argv[0]!;
      const script = process.argv[1]!;
      const spawnArgs: string[] = [bin, script, "serve"];
      if (options.surface !== DEFAULTS.surface) spawnArgs.push("--surface", options.surface);
      if (options.profile !== DEFAULTS.profile) spawnArgs.push("--profile", options.profile);
      if (options.mode !== DEFAULTS.mode) spawnArgs.push("--mode", options.mode);
      if (options.lane) spawnArgs.push("--lane", options.lane);

      const child = Bun.spawn(spawnArgs, {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      child.unref();

      console.log(`\n${CLR.accent}⏺${CLR.reset} Switchbay API server started in background (detached).`);
      console.log(`URL: http://${host}:${port}\n`);
      return;
    }

    const { startApiServer } = await import("./src/api/server");
    try {
      const server = startApiServer();
      console.log(`Switchbay API listening on http://${server.hostname}:${server.port}`);
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" || err?.message?.includes("EADDRINUSE")) {
        console.error(`\n${CLR.error}Error: Port is already in use.${CLR.reset}`);
        console.error("The Switchbay background service or another instance is likely already running.");
        console.error("You can:");
        console.error("  1. Check service status:   switchbay service status");
        console.error("  2. Uninstall the service:  switchbay service uninstall");
        console.error("  3. Run on another port:    SWITCHBAY_API_PORT=7350 switchbay serve\n");
        process.exit(1);
      }
      throw err;
    }
    return;
  }

  if (options.subcommand === "service") {
    const { runServiceCommand } = await import("./src/service/macos");
    const action = options.serviceAction ?? "status";
    const result = await runServiceCommand(action);
    console.log(cliPage({ title: "Switchbay Service", state: action === "status" ? "System status" : action, body: result, next: action === "status" ? "switchbay service restart" : "switchbay service status" }));
    return;
  }

  if (options.subcommand === "update") {
    await runUpdateCommand();
    return;
  }

  if (options.subcommand === "benchmark") {
    if (options.benchmarkPre) {
      await runPreBenchCommand();
    } else {
      await runBenchmarkCommand(options.benchmarkModel ?? null, options.benchmarkLane ?? null, options.benchmarkVerbose ?? false);
    }
    return;
  }

  if (options.subcommand === "sync") {
    await runSyncCommand();
    return;
  }

  if (options.subcommand === "engines") {
    await runEngineCommand(options.engineAction, options.engineFix ?? false);
    return;
  }

  if (options.subcommand === "skills" || options.subcommand === "toolbox") {
    await runToolboxCommand(options.toolboxAction, options.toolboxSkill, options.subcommand);
    return;
  }

  if (options.subcommand === "plugins") {
    await runPluginCommand(options.pluginAction ?? "status", options.pluginId ?? null);
    return;
  }

  if (options.subcommand === "agents") {
    await runAgentsCommand(
      options.agentAction ?? "status",
      options.agentId ?? null,
      {
        name: options.agentName ?? null,
        specialty: options.agentSpecialty ?? null,
        approach: options.agentApproach ?? null,
        rules: options.agentRules ?? null,
        scope: options.agentScope ?? "workspace",
      },
    );
    return;
  }

  if (options.subcommand === "memory") {
    await runMemoryCommand(options.memoryAction, options.memoryNote);
    return;
  }

  if (options.subcommand === "agenda") {
    console.log(cliPage({ title: "Daily Board", state: "Today", body: describeDailyBoard(), next: 'switchbay task add "<task>"' }));
    return;
  }

  if (options.subcommand === "task") {
    await runTaskCommand(options.taskAction ?? "status", options.taskText ?? null, options.taskId ?? null);
    return;
  }

  if (options.subcommand === "knowledge") {
    await runKnowledgeCommand(options.knowledgeAction, options.knowledgeQuery);
    return;
  }

  if (options.subcommand === "trace") {
    await runTraceCommand(options.traceAction);
    return;
  }

  if (options.subcommand === "usage") {
    console.log(cliPage({ title: "Usage Center", state: "Workspace telemetry", body: formatUsage(await listTraceRecords(process.cwd())), next: "switchbay graph trace" }));
    return;
  }

  if (options.subcommand === "graph") {
    console.log(cliPage({ title: "Execution Graph", state: "Latest turn", body: formatTraceGraph((await loadLatestTrace(process.cwd()))?.record ?? null), next: "switchbay trace" }));
    return;
  }

  if (options.subcommand === "radar") {
    await runRadarCommand(options.lane);
    return;
  }

  if (options.subcommand === "handoff") {
    await runHandoffCommand();
    return;
  }

  if (options.subcommand === "mcp") {
    await runMcpCommand(options.mcpAction);
    return;
  }

  if (options.subcommand === "docs") {
    const { openSwitchbayWorkspace } = await import("./src/web/launcher");
    console.log(await openSwitchbayWorkspace("Docs"));
    return;
  }

  if (options.subcommand === "inspect") {
    await runInspectCommand(options.inspectImagePath ?? null, options.inspectQuestion ?? null, options.inspectTask ?? null, options.lane);
    return;
  }

  if (options.subcommand === "images") {
    await runImagesCommand();
    return;
  }

  if (options.subcommand === "extension") {
    await runExtensionCommand(options.extensionAction ?? "serve");
    return;
  }

  if (options.subcommand === "litert") {
    await runLiteRtCommand(options);
    return;
  }

  // Internal flag: foreground extension server (called by the daemon child)
  if (process.argv.includes("--extension-serve-fg")) {
    const { startExtensionServer } = await import("./src/extension/server");
    startExtensionServer();
    return;
  }

  if (options.subcommand === "brief") {
    await runBriefCommand(options.briefAction ?? "list", options.briefName ?? null, options.briefPrompt ?? null, options.lane);
    return;
  }

  if (options.subcommand === "models") {
    await runModelsCommand(options.lane, options.modelsAction ?? "list", options.modelsAll ?? false, options.modelsTrusted ?? false, options.modelsProvider ?? null);
    return;
  }

  if (options.subcommand === "model") {
    await runModelCommand(options.lane, options.modelLane, options.modelTarget, options.modelAction ?? "show", options.modelQuantization ?? null, options.modelLabel ?? null, options.yes ?? false);
    return;
  }

  if (options.subcommand === "local-mode") {
    runLocalModeCommand(options.localModeAction ?? "status", options.localModeValue ?? null);
    return;
  }

  if (options.subcommand === "local-provider") {
    await runLocalProviderCommand(options.localProviderAction ?? "status", options.localProviderTarget ?? null);
    return;
  }

  if (options.subcommand === "cloud-provider") {
    await runCloudProviderCommand(options.cloudProviderAction ?? "status", options.cloudProviderTarget ?? null);
    return;
  }

  if (options.subcommand !== "run") return;

  if (options.purge) {
    const duration = options.purge.toLowerCase();
    let ms = 0;
    const match = duration.match(/^(\d+)([dw])$/);
    if (match?.[1] && match[2]) {
      const count = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === "d") ms = count * 24 * 60 * 60 * 1000;
      else if (unit === "w") ms = count * 7 * 24 * 60 * 60 * 1000;
    } else {
      console.error(`switchbay: invalid purge duration "${options.purge}". Use e.g. 1d, 5d, 2w.`);
      process.exit(1);
    }
    
    const count = await purgeSessions(ms);
    console.log(`switchbay: purged ${count} old session(s).`);
    if (!options.resume && !options.initialQuery) {
        process.exit(0);
    }
  }

  let resumeId: string | null = null;
  if (options.resume && !options.newSession) {
    if (typeof options.resume === "string") {
      if (/^\d+$/.test(options.resume)) {
        const sessions = await listSessions();
        const index = parseInt(options.resume, 10);
        if (sessions[index]) {
          resumeId = sessions[index].id;
        } else {
          console.error(`switchbay: session index ${index} not found. Use /sessions to see history.`);
          process.exit(1);
        }
      } else {
        resumeId = options.resume;
      }
    } else {
      resumeId = "latest";
    }
  }

  if (options.hop) {
    await applyInitialHop(options.hop);
  }

  // CLI Mode: One-shot query provided
  if (options.initialQuery) {
    await runCliMode(options, resumeId);
    process.exit(0);
  }

  // TUI Mode: No query, launch interactive app
  const lane = normalizeRuntimeLane(options.lane);
  const localProvider = normalizeLocalProvider(options.lane);
  const cloudProvider = normalizeCloudProvider(options.lane);
  const selected = getSelectedRuntimeModel(lane);
  const localMode = getLocalMode();
  const onAppleEscalationConfirm = localMode !== "off"
    ? async (targetVariant: import("./src/runtime/apple-fm-client").AppleVariant) => {
        const label = targetVariant === "cloud-pro" ? "AFM 3 Cloud Pro (PCC · reasoning)" : "AFM 3 Cloud (PCC · fast)";
        const privacy = "Apple Private Cloud Compute — Apple cannot access your data.";
        return confirm(`  Local-mode routing suggests ${label}\n  ${privacy}\n  Switch to cloud for this task?`);
      }
    : undefined;
  const client = createRuntimeClient(lane, selected
    ? { model: selected.id, provider: normalizeClientProvider(selected.provider) ?? normalizeClientCloudProvider(cloudProvider), localProvider, onAppleEscalationConfirm }
    : { localProvider, provider: normalizeClientCloudProvider(cloudProvider), onAppleEscalationConfirm });
  render(
    <SwitchbayApp
      client={client}
      lane={lane}
      initialHopLabel={null}
      initialQuery=""
      mode={options.mode}
      profile={options.profile}
      surface={options.surface}
      resumeId={resumeId}
    />,
  );
}

async function applyInitialHop(query: string) {
  const matches = await fuzzyMatchLocations(query);
  if (!matches.length) {
    console.error(`switchbay: no workspace matched "${query}". Use /workspace add <path> or enable auto_discover.`);
    process.exit(1);
  }

  const target = matches[0]!;
  const result = await travelTo(target.absPath);
  if (!result.ok) {
    console.error(`switchbay: hop failed: ${result.error}`);
    process.exit(1);
  }
}

async function runPreBenchCommand() {
  const color = cliColorEnabled();
  const ANSI = {
    reset: "[0m", bold: "[1m",
    green: "[38;5;42m", yellow: "[38;5;214m",
    red: "[38;5;203m", cyan: "[38;5;44m",
    muted: "[38;5;244m", bright: "[38;5;51m",
  };
  const paint = (s: string, code: string) => color ? `${code}${s}${ANSI.reset}` : s;

  const seen = new Set<string>();
  const targets = getCloudModelPresets().filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });

  console.log(`\n${paint("◆", ANSI.bright)} ${paint("Switchbay Pre-Bench", ANSI.bold)} ${paint(`· ${targets.length} cloud models`, ANSI.muted)}\n`);

  type BenchEntry =
    | { kind: "ok"; grade: string; score: number; trusted: boolean }
    | { kind: "config-error"; reason: string }   // auth / key / quota
    | { kind: "error"; reason: string };          // network, timeout, unexpected

  const CONCURRENCY = 3;
  const queue = [...targets];
  const resultMap = new Map<string, BenchEntry>();

  function classifyError(err: any): BenchEntry {
    const msg: string = (err?.message ?? String(err)).toLowerCase();
    const isConfigErr =
      /401|403|unauthorized|invalid.?api.?key|api.?key|authentication|permission|quota|billing|no.?key|not.?configured/.test(msg) ||
      /invalid_api_key|insufficient_quota|access.?denied/.test(msg);
    const short = (err?.message ?? String(err)).slice(0, 72);
    return isConfigErr
      ? { kind: "config-error", reason: short }
      : { kind: "error", reason: short };
  }

  // Run concurrently but collect results silently — print in original order after
  async function worker() {
    while (true) {
      const model = queue.shift();
      if (!model) break;
      try {
        const client = createRuntimeClient("cloud", { model: model.id, provider: model.provider as any });
        const report = await runPreBench(client, model.id, model.provider);
        saveModelGrade({ modelId: model.id, provider: model.provider, grade: report.grade, score: report.score, passedTests: report.passedTests, totalTests: report.totalTests, benchedAt: Date.now() });
        resultMap.set(model.id, { kind: "ok", grade: report.grade, score: report.score, trusted: isTrusted(report as any) });
      } catch (err: any) {
        resultMap.set(model.id, classifyError(err));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Print in original order
  for (const model of targets) {
    const r = resultMap.get(model.id)!;
    if (r.kind === "config-error") {
      console.log(`  ${paint("○", ANSI.muted)} ${model.id.padEnd(38)} ${paint("—", ANSI.muted)}   ${paint("no key / auth error", ANSI.yellow)}  ${paint(r.reason, ANSI.muted)}`);
    } else if (r.kind === "error") {
      console.log(`  ${paint("!", ANSI.red)} ${model.id.padEnd(38)} ${paint("—", ANSI.muted)}   ${paint("error", ANSI.red)}  ${paint(r.reason, ANSI.muted)}`);
    } else {
      const gradeColor = r.trusted ? ANSI.green : r.grade === "C" ? ANSI.yellow : ANSI.red;
      const tag = r.trusted ? paint("✓ trusted", ANSI.green) : paint("✗ not trusted", ANSI.muted);
      const gradeStr = paint(r.grade.padEnd(2), `${gradeColor}${ANSI.bold}`);
      const scoreStr = paint(`${r.score}/100`, ANSI.muted);
      console.log(`  ${paint("●", ANSI.cyan)} ${model.id.padEnd(38)} ${gradeStr}  ${scoreStr}  ${tag}`);
    }
  }

  const trusted = [...resultMap.values()].filter((r): r is Extract<BenchEntry, { kind: "ok" }> => r.kind === "ok" && r.trusted);
  console.log(`\n${"─".repeat(64)}`);
  console.log(`  ${paint("Trusted (A/B)", ANSI.muted)}  ${paint(`${trusted.length}/${targets.length}`, ANSI.bold)}    ${paint("Run:", ANSI.muted)}  ${paint("switchbay models --trusted", ANSI.cyan)}`);
  console.log();
}

async function runBenchmarkCommand(model: string | null, lane: string | null, verbose = false) {
  const color = cliColorEnabled();
  const ANSI = {
    reset: "[0m", bold: "[1m",
    green: "[38;5;42m", yellow: "[38;5;214m",
    red: "[38;5;203m", cyan: "[38;5;44m",
    muted: "[38;5;244m", bright: "[38;5;51m",
  };
  const paint = (s: string, code: string) => color ? `${code}${s}${ANSI.reset}` : s;

  const runtimeLane = normalizeRuntimeLane(lane ?? "cloud");
  const client = createRuntimeClient(runtimeLane, { model: model ?? undefined });
  const modelLabel = model ?? getRuntimeLaneLabel(runtimeLane);

  console.log(`\n${paint("◆", ANSI.bright)} ${paint("Switchbay Benchmark", ANSI.bold)} ${paint(`· ${modelLabel}`, ANSI.muted)}\n`);

  const categoryWidth = 10;
  const nameWidth = 28;

  try {
    const report = await runBenchmark(client, modelLabel, runtimeLane, (result: BenchmarkResult, index: number, total: number) => {
      const icon = result.passed ? paint("✓", ANSI.green) : paint("✗", ANSI.red);
      const cat = paint(result.category.padEnd(categoryWidth), ANSI.muted);
      const name = result.name.padEnd(nameWidth);
      const pct = paint(`${Math.round(result.score * 100)}%`.padStart(4), result.score >= 0.75 ? ANSI.green : result.score >= 0.4 ? ANSI.yellow : ANSI.red);
      const ms = paint(`${result.latencyMs}ms`, ANSI.muted);
      const detail = paint(result.detail.slice(0, 40), ANSI.muted);
      console.log(`  ${icon}  ${cat}  ${name}  ${pct}  ${ms}  ${detail}`);
      if (verbose && result.rawText) {
        const lines = result.rawText.trim().split("\n");
        for (const line of lines) {
          console.log(`       ${paint(line, ANSI.muted)}`);
        }
        console.log();
      }
    });

    const gradeColor = report.grade.startsWith("A") ? ANSI.green : report.grade === "B" ? ANSI.cyan : report.grade === "C" ? ANSI.yellow : ANSI.red;
    const passed = report.results.filter(r => r.passed).length;
    const total = report.results.length;
    const dur = `${(report.durationMs / 1000).toFixed(1)}s`;

    console.log(`\n${"─".repeat(72)}`);
    console.log(`  ${paint("Grade", ANSI.muted)}  ${paint(report.grade, `${gradeColor}${ANSI.bold}`)}    ${paint("Score", ANSI.muted)}  ${paint(`${report.totalScore}/100`, ANSI.bold)}    ${paint("Passed", ANSI.muted)}  ${paint(`${passed}/${total}`, ANSI.bold)}    ${paint("Time", ANSI.muted)}  ${paint(dur, ANSI.bold)}`);
    console.log();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Benchmark failed", msg, [`switchbay benchmark --lane <cloud|openrouter|local>`]));
    process.exit(1);
  }
}

async function runSyncCommand() {
  try {
    const [engineResult, skillResult] = await Promise.allSettled([
      syncEngineBayWithDiff(),
      syncToolboxWithDiff(),
    ]);
    const engineOk = engineResult.status === "fulfilled";
    const skillOk = skillResult.status === "fulfilled";
    const engineDiff = engineOk ? (engineResult as PromiseFulfilledResult<any>).value : null;
    const skillDiff = skillOk ? (skillResult as PromiseFulfilledResult<any>).value : null;
    const engineBlocked = engineOk && engineDiff.blocked > 0 ? ` · ${engineDiff.blocked} blocked` : "";
    const skillBlocked = skillOk && skillDiff.blocked > 0 ? ` · ${skillDiff.blocked} blocked` : "";
    const engineMsg = engineOk ? `${engineDiff.after} engines${engineDiff.added > 0 ? ` (+${engineDiff.added} new)` : ", up to date"}${engineBlocked}` : `Failed: ${(engineResult as PromiseRejectedResult).reason?.message ?? "unknown error"}`;
    const skillMsg = skillOk ? `${skillDiff.after} skills${skillDiff.added > 0 ? ` (+${skillDiff.added} new)` : ", up to date"}${skillBlocked}` : `Failed: ${(skillResult as PromiseRejectedResult).reason?.message ?? "unknown error"}`;
    console.log(cliReceipt(
      "Sync",
      engineOk && skillOk ? "All libraries synchronized" : "Sync completed with errors",
      [["Engines", engineMsg], ["Skills", skillMsg]],
      "switchbay engines list · switchbay skills list",
    ));
    const allBlocked = [
      ...(engineOk ? engineDiff.blockDetails : []),
      ...(skillOk ? skillDiff.blockDetails : []),
    ];
    if (allBlocked.length > 0) {
      process.stdout.write(`\n${CLR.bold}Security Rejections${CLR.reset}\n\n`);
      for (const item of allBlocked) {
        process.stdout.write(`  \x1b[31m✗\x1b[0m  ${item.name}\n`);
        for (const line of item.findings.split("\n")) {
          process.stdout.write(`     ${CLR.muted}${line}${CLR.reset}\n`);
        }
      }
      process.stdout.write("\n");
    }
    if (!engineOk || !skillOk) process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Sync", msg, ["switchbay engines sync", "switchbay skills sync"]));
    process.exit(1);
  }
}

async function runEngineCommand(action: "status" | "sync" | "list" | "templates" | "health", fix = false) {
  try {
    if (action === "sync") {
      const diff = await syncEngineBayWithDiff();
      const detail = diff.added > 0 ? `+${diff.added} new` : "up to date";
      const notes: string[] = [];
      if (diff.blocked > 0) notes.push(`${diff.blocked} blocked by security scan`);
      console.log(cliReceipt("Engine Bay", `Library synchronized — ${diff.after} engines (${detail})`, notes, "switchbay engines list"));
      if (diff.blockDetails.length > 0) {
        process.stdout.write(`\n${CLR.bold}Security Rejections${CLR.reset}\n\n`);
        for (const item of diff.blockDetails) {
          process.stdout.write(`  \x1b[31m✗\x1b[0m  ${item.name}\n`);
          for (const line of item.findings.split("\n")) {
            process.stdout.write(`     ${CLR.muted}${line}${CLR.reset}\n`);
          }
        }
        process.stdout.write("\n");
      }
      return;
    }

    const inventory = await loadEngineBayInventory();
    if (action === "templates") {
      console.log(renderCliList({
        title: "Engine Templates", count: inventory.templates.length, noun: "template",
        columns: [{ key: "path", label: "Path", width: 76 }],
        rows: inventory.templates.map((path) => ({ path })),
        empty: "No Engine Bay templates found.", hint: "Refresh: switchbay engines sync",
      }));
      return;
    }
    if (action === "health") {
      const results = await healthCheckEngines(process.cwd());
      if (!results.length) {
        process.stdout.write(`${CLR.muted}No registered engines. Sync Engine Bay or add a workspace manifest.${CLR.reset}\n`);
        return;
      }
      process.stdout.write(`\n${CLR.bold}Engine Health${CLR.reset}\n\n`);
      for (const engine of results) {
        const icon = engine.status === "ok" ? `${CLR.accent}✓${CLR.reset}` : engine.status === "warn" ? `${CLR.muted}⚠${CLR.reset}` : `\x1b[31m✗\x1b[0m`;
        const toolLabel = `${engine.toolCount} tool${engine.toolCount === 1 ? "" : "s"}`;
        process.stdout.write(`  ${icon}  ${engine.name}  ${CLR.muted}${engine.id} · ${toolLabel}${CLR.reset}\n`);

        // Deduplicate missing executables — group by path, show count if > 1
        const missing = engine.tools.filter((t) => t.status === "missing");
        const missingByExec = new Map<string, number>();
        for (const t of missing) {
          const key = t.executable ?? t.name;
          missingByExec.set(key, (missingByExec.get(key) ?? 0) + 1);
        }
        for (const [exec, count] of missingByExec) {
          const suffix = count > 1 ? ` ${CLR.muted}(${count} tools)${CLR.reset}` : "";
          process.stdout.write(`       \x1b[31m✗\x1b[0m ${CLR.muted}${exec} not found${CLR.reset}${suffix}\n`);
        }

        if (engine.doctorLines.length > 0) {
          for (const line of engine.doctorLines) {
            process.stdout.write(`       ${CLR.muted}${line}${CLR.reset}\n`);
          }
        } else if (engine.doctorOk === false) {
          process.stdout.write(`       \x1b[31m✗\x1b[0m ${CLR.muted}doctor failed${CLR.reset}\n`);
        }
      }
      const ok = results.filter((r) => r.status === "ok").length;
      const fail = results.filter((r) => r.status === "fail").length;
      process.stdout.write(`\n  ${CLR.muted}${ok}/${results.length} healthy${fail > 0 ? ` · ${fail} broken` : ""}${CLR.reset}\n\n`);

      if (fix) {
        const broken = results.filter((r) => r.status !== "ok");
        if (!broken.length) {
          process.stdout.write(`${CLR.muted}Nothing to fix.${CLR.reset}\n\n`);
          return;
        }
        process.stdout.write(`${CLR.bold}Fixing${CLR.reset}  ${CLR.muted}${broken.length} engine${broken.length === 1 ? "" : "s"}${CLR.reset}\n\n`);
        const fixes = await fixEngines(results, process.cwd());
        for (const fix of fixes) {
          process.stdout.write(`  ${fix.name}\n`);
          if (!fix.steps.length) {
            process.stdout.write(`     ${CLR.muted}No automatic fix available${CLR.reset}\n`);
          }
          for (const step of fix.steps) {
            const icon = step.ok ? `${CLR.accent}✓${CLR.reset}` : `\x1b[31m✗\x1b[0m`;
            process.stdout.write(`     ${icon}  ${step.label}\n`);
            if (step.output) process.stdout.write(`        ${CLR.muted}${step.output}${CLR.reset}\n`);
          }
        }
        // Re-run health to show updated state
        process.stdout.write(`\n${CLR.muted}Re-checking...${CLR.reset}\n\n`);
        const recheck = await healthCheckEngines(process.cwd());
        const nowOk = recheck.filter((r) => r.status === "ok").length;
        process.stdout.write(`  ${CLR.muted}${nowOk}/${recheck.length} healthy after fix${CLR.reset}\n\n`);
      }
      return;
    }
    if (action === "list") {
      const registry = await loadEngineRegistry(process.cwd());
      console.log(renderCliList({
        title: "Engines",
        count: registry.engines.length,
        noun: "engine",
        summary: `${registry.engines.length} registered`,
        columns: [
          { key: "id", label: "ID", width: 22 },
          { key: "name", label: "Name", width: 28 },
          { key: "tools", label: "Tools", width: 8 },
          { key: "approval", label: "Gated", width: 7 },
        ],
        rows: registry.engines.map((engine) => ({
          id: engine.id,
          name: engine.name,
          tools: engine.tools.length,
          approval: engine.tools.filter((tool) => tool.approval === "always").length,
        })),
        empty: "No registered engines. Sync Engine Bay or add a workspace manifest.",
        hint: "Details in the TUI: /engines · Hub files: switchbay engines templates",
      }));
      if (registry.warnings.length) console.log(`\n${CLR.muted}${registry.warnings.length} manifest warning(s); run switchbay engines for details.${CLR.reset}`);
      return;
    }
    const registry = await loadEngineRegistry(process.cwd());
    console.log(cliPage({
      title: "Engine Bay", state: inventory.exists ? "Ready" : "Not synchronized",
      summary: "Reusable tools available to every model lane.",
      rows: [["Engines", String(registry.engines.length)], ["Tools", String(registry.engines.reduce((n, engine) => n + engine.tools.length, 0))], ["Templates", String(inventory.templates.length)], ["Revision", inventory.head ?? "—"], ["Library", inventory.path.replace(process.env.HOME ?? "", "~")]],
      next: inventory.exists ? "switchbay engines list" : "switchbay engines sync",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Engine Bay", msg, ["switchbay engines sync"]));
    process.exit(1);
  }
}

async function runToolboxCommand(
  action: "status" | "sync" | "list" | "templates" | "read" | "health",
  skillId: string | null,
  commandName: "skills" | "toolbox" = "skills",
) {
  const command = `switchbay ${commandName}`;
  try {
    if (action === "sync") {
      const diff = await syncToolboxWithDiff();
      const detail = diff.added > 0 ? `+${diff.added} new` : "up to date";
      const notes: string[] = [];
      if (diff.blocked > 0) notes.push(`${diff.blocked} blocked by security scan`);
      console.log(cliReceipt("Skill Library", `Library synchronized — ${diff.after} skills (${detail})`, notes, `${command} list`));
      if (diff.blockDetails.length > 0) {
        process.stdout.write(`\n${CLR.bold}Security Rejections${CLR.reset}\n\n`);
        for (const item of diff.blockDetails) {
          process.stdout.write(`  \x1b[31m✗\x1b[0m  ${item.name}\n`);
          for (const line of item.findings.split("\n")) {
            process.stdout.write(`     ${CLR.muted}${line}${CLR.reset}\n`);
          }
        }
        process.stdout.write("\n");
      }
      return;
    }

    const inventory = await loadToolboxInventory();
    if (action === "health") {
      const skills = inventory.skills;
      if (!skills.length) {
        process.stdout.write(`${CLR.muted}No skills found. Sync the Toolbox first: switchbay skills sync${CLR.reset}\n`);
        return;
      }
      process.stdout.write(`\n${CLR.bold}Skill Health${CLR.reset}\n\n`);
      let ok = 0;
      let broken = 0;
      for (const skill of skills) {
        const fileOk = await Bun.file(skill.path).exists();
        const hasBody = skill.body.trim().length > 0;
        const healthy = fileOk && hasBody;
        healthy ? ok++ : broken++;
        if (!healthy) {
          const icon = `\x1b[31m✗\x1b[0m`;
          const reason = !fileOk ? "file missing" : "empty body";
          process.stdout.write(`  ${icon}  ${CLR.bold}${skill.id}${CLR.reset}  ${CLR.muted}${reason}${CLR.reset}\n`);
          process.stdout.write(`         ${skill.path}\n`);
        }
      }
      if (broken === 0) {
        process.stdout.write(`  ${CLR.accent}✓${CLR.reset}  All ${ok} skill${ok === 1 ? "" : "s"} healthy\n`);
      }
      process.stdout.write(`\n  ${CLR.muted}${ok}/${skills.length} healthy${broken > 0 ? ` · ${broken} broken` : ""}${CLR.reset}\n\n`);
      return;
    }
    if (action === "templates") {
      console.log(renderCliList({
        title: "Skill Templates", count: inventory.templates.length, noun: "template",
        columns: [{ key: "path", label: "Path", width: 76 }],
        rows: inventory.templates.map((path) => ({ path })),
        empty: "No skill templates found.", hint: `Refresh: ${command} sync`,
      }));
      return;
    }
    if (action === "list") {
      console.log(renderCliList({
        title: "Skills",
        count: inventory.skills.length,
        noun: "skill",
        summary: `${inventory.skills.length} available`,
        columns: [
          { key: "id", label: "ID", width: 30 },
          { key: "source", label: "Source", width: 10 },
          { key: "name", label: "Name", width: 34 },
        ],
        rows: inventory.skills.map((skill) => ({ id: skill.id, source: skill.source, name: skill.name })),
        empty: "No skills found. Sync the Toolbox to load shared skills.",
        hint: `Read one: ${command} read <id> · Browse descriptions in the TUI: /skills`,
      }));
      return;
    }
    if (action === "read") {
      if (!skillId) {
        console.error(cliFailure("Skill Library", "A skill id is required.", [`${command} read <id>`]));
        process.exit(1);
      }
      const skill = await readToolboxSkill(skillId);
      if (!skill) {
        console.error(cliFailure("Skill Library", `No skill named ${skillId}.`, [`${command} list`]));
        process.exit(1);
      }
      console.log(skill.body);
      return;
    }
    console.log(cliPage({ title: "Skill Library", state: inventory.exists ? "Ready" : "Not synchronized", summary: "Operational guides models can load when the work calls for them.", rows: [["Skills", String(inventory.skills.length)], ["Templates", String(inventory.templates.length)], ["Revision", inventory.head ?? "—"], ["Library", inventory.path.replace(process.env.HOME ?? "", "~")]], next: inventory.exists ? `${command} list` : `${command} sync` }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Skill Library", msg, [`${command} list`]));
    process.exit(1);
  }
}

async function runPluginCommand(action: "status" | "list" | "inspect", pluginId: string | null) {
  try {
    if (action === "list") {
      const inventory = await loadPluginInventory();
      console.log(renderCliList({
        title: "Plugins",
        count: inventory.plugins.length,
        noun: "plugin",
        summary: `${inventory.plugins.length} installed`,
        columns: [
          { key: "id", label: "ID", width: 24 },
          { key: "state", label: "State", width: 10 },
          { key: "assets", label: "Assets", width: 10 },
          { key: "name", label: "Name", width: 32 },
        ],
        rows: inventory.plugins.map((plugin) => ({
          id: plugin.manifest.id,
          state: plugin.manifest.enabled ? "enabled" : "disabled",
          assets: plugin.manifest.agents.length + plugin.manifest.skills.length + plugin.manifest.engines.length + plugin.manifest.guides.length + plugin.manifest.knowledge.length + plugin.manifest.mcp.length,
          name: plugin.manifest.name,
        })),
        empty: "No plugins installed in this workspace.",
        hint: "Create one in the TUI: /create-plugin · Inspect: switchbay plugins inspect <id>",
      }));
      return;
    }

    if (action === "inspect") {
      if (!pluginId) {
        console.error(cliFailure("Plugins", "A plugin id is required.", ["switchbay plugins inspect <id>"]));
        process.exit(1);
      }
      const plugin = await readPlugin(pluginId);
      if (!plugin) {
        console.error(cliFailure("Plugins", `No plugin named ${pluginId}.`, ["switchbay plugins list"]));
        process.exit(1);
      }
      console.log(JSON.stringify(plugin.manifest, null, 2));
      return;
    }

    const inventory = await loadPluginInventory();
    const enabled = inventory.plugins.filter((plugin) => plugin.manifest.enabled).length;
    console.log(cliPage({ title: "Plugins", state: inventory.plugins.length ? `${enabled} enabled` : "None installed", summary: "Workspace capability packs for agents, skills, engines, guides, and MCP.", rows: [["Installed", String(inventory.plugins.length)], ["Enabled", String(enabled)]], next: "switchbay plugins list" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Plugins", msg, ["switchbay plugins list"]));
    process.exit(1);
  }
}

async function runAgentsCommand(
  action: "status" | "list" | "create" | "read",
  agentId: string | null,
  draft: {
    name: string | null;
    specialty: string | null;
    approach: string | null;
    rules: string | null;
    scope: AgentScope;
  },
) {
  try {
    const cwd = process.cwd();
    if (action === "create") {
      if (!draft.name?.trim() || !draft.specialty?.trim()) {
        console.error("switchbay agents create: requires a name and specialty.");
        console.error('Example: switchbay agent create --name "API Steward" --specialty "API design and integration checks"');
        console.error('Example: switchbay agent create "API Steward" "API design and integration checks" --rules "Never expose secrets."');
        process.exit(1);
      }

      const saved = await saveAgentDefinition({
        name: draft.name,
        specialty: draft.specialty,
        approach: draft.approach ?? undefined,
        rules: draft.rules ?? undefined,
        scope: draft.scope,
      }, cwd);
      console.log(cliReceipt("Agent created", saved.id, [["Location", saved.savePath.replace(process.env.HOME ?? "", "~")], ["Scope", draft.scope]], `switchbay agents read ${saved.id}`));
      return;
    }

    const agents = await loadAllAgents(cwd);
    if (action === "read") {
      if (!agentId) {
        console.error("switchbay agents read: requires an agent id.");
        process.exit(1);
      }
      const agent = findAgent(agentId, agents);
      if (!agent) {
        console.error(`switchbay agents: agent not found: ${agentId}`);
        process.exit(1);
      }
      if (agent.path) {
        const { readFile } = await import("node:fs/promises");
        console.log(await readFile(agent.path, "utf-8"));
        return;
      }
      console.log(`# ${agent.name}
id: ${agent.id}
emoji: ${agent.emoji}
description: ${agent.description}

${agent.prompt}
`);
      return;
    }

    const customCount = agents.filter((agent) => agent.custom).length;
    if (action === "list") {
      console.log(renderCliList({
        title: "Agents",
        count: agents.length,
        noun: "agent",
        summary: `${agents.length} available`,
        columns: [
          { key: "id", label: "ID", width: 20 },
          { key: "source", label: "Source", width: 11 },
          { key: "name", label: "Name", width: 24 },
          { key: "specialty", label: "Specialty", width: 38 },
        ],
        rows: agents.map((agent) => ({ id: agent.id, source: agent.source ?? "builtin", name: agent.name, specialty: agent.description })),
        empty: "No agents available.",
        hint: "Read one: switchbay agents read <id> · Activate in the TUI: /agent <id>",
      }));
      return;
    }

    console.log(cliPage({ title: "Agents", state: `${agents.length} available`, summary: "Specialist workers models can select for focused jobs.", rows: [["Built in", String(agents.length - customCount)], ["Custom", String(customCount)]], next: "switchbay agents list" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay agents: ${msg}`);
    process.exit(1);
  }
}

async function runMemoryCommand(action: "status" | "refresh" | "list" | "facts" | "add", note: string | null) {
  try {
    const cwd = process.cwd();
    if (action === "add") {
      if (!note?.trim()) {
        console.error('switchbay memory: add requires a note, e.g. `switchbay memory add "use Bun for tests"`.');
        process.exit(1);
      }
      const count = await addMemoryNote(cwd, note);
      console.log(cliReceipt("Workspace Memory", "Note saved", [["Note", note.trim()], ["Total", `${count} note${count === 1 ? "" : "s"}`]], "switchbay memory list"));
      return;
    }
    if (action === "refresh") {
      console.log(await refreshMemory(cwd));
      return;
    }
    if (action === "list") {
      const notes = await listMemoryNotes(cwd);
      console.log(renderCliList({
        title: "Memory Notes", count: notes.length, noun: "note",
        columns: [{ key: "index", label: "#", width: 4 }, { key: "note", label: "Note", width: 72 }],
        rows: notes.map((note, index) => ({ index, note })),
        empty: "No workspace memory notes yet.", hint: 'Add one: switchbay memory add "use Bun for tests"',
      }));
      return;
    }
    if (action === "facts") {
      const facts = await readMemoryFacts(cwd);
      console.log(renderCliList({
        title: "Memory Facts", count: facts.length, noun: "fact",
        columns: [{ key: "key", label: "Key", width: 28 }, { key: "value", label: "Value", width: 56 }],
        rows: facts.map((fact) => ({ key: fact.key, value: fact.value })),
        empty: "No structured memory facts yet.", hint: "Build them: switchbay memory refresh",
      }));
      return;
    }
    console.log(cliPage({ title: "Workspace Memory", state: "Ready", body: await describeMemory(cwd), next: "switchbay memory list" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay memory: ${msg}`);
    process.exit(1);
  }
}

async function runTaskCommand(action: "status" | "add" | "done" | "clear", text: string | null, id: number | null) {
  try {
    if (action === "add") {
      if (!text?.trim()) {
        console.error("switchbay task add: requires task text.");
        process.exit(1);
      }
      const task = addDailyTask(text);
      console.log(cliReceipt("Daily Board", `Task ${task.id} added`, [["Task", task.text]], "switchbay agenda"));
      return;
    }

    if (action === "done") {
      if (!id) {
        console.error("switchbay task done: requires a task id.");
        process.exit(1);
      }
      const task = completeDailyTask(id);
      if (!task) {
        console.error(`switchbay task done: task ${id} not found on today's board.`);
        process.exit(1);
      }
      console.log(cliReceipt("Daily Board", `Task ${task.id} completed`, [["Task", task.text]], "switchbay agenda"));
      return;
    }

    if (action === "clear") {
      const count = clearDailyBoard();
      console.log(cliReceipt("Daily Board", "Cleared", [["Removed", `${count} task${count === 1 ? "" : "s"}`]], "switchbay agenda"));
      return;
    }

    console.log(cliPage({ title: "Daily Board", state: "Today", body: describeDailyBoard(), next: 'switchbay task add "<task>"' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay task: ${msg}`);
    process.exit(1);
  }
}

async function runKnowledgeCommand(action: "status" | "refresh" | "search", query: string | null) {
  try {
    const cwd = process.cwd();
    if (action === "refresh") {
      const index = await refreshKnowledgeIndex(cwd);
      console.log(cliReceipt("Knowledge Index", "Refreshed", [["Files", String(index.fileCount)], ["Chunks", String(index.chunkCount)]], 'switchbay knowledge search "<query>"'));
      return;
    }
    if (action === "search") {
      if (!query) {
        console.error("switchbay knowledge: search requires a query.");
        process.exit(1);
      }
      console.log(cliPage({ title: "Knowledge Search", state: query, body: formatKnowledgeSearchResults(await searchKnowledgeIndex(query, cwd, 10)), next: "switchbay knowledge refresh" }));
      return;
    }
    console.log(cliPage({ title: "Knowledge Index", state: "Workspace", body: await describeKnowledgeIndex(cwd), next: 'switchbay knowledge search "<query>"' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay knowledge: ${msg}`);
    process.exit(1);
  }
}

async function runTraceCommand(action: "last" | "export") {
  try {
    const cwd = process.cwd();
    if (action === "export") {
      const tracePath = await latestTraceExportPath(cwd);
      console.log(tracePath ?? "No trace exists yet. Complete a model turn first.");
      return;
    }
    console.log(cliPage({ title: "Trace Ledger", state: "Latest turn", body: await describeLatestTrace(cwd), next: "switchbay graph trace" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay trace: ${msg}`);
    process.exit(1);
  }
}

async function runRadarCommand(rawLane: string | null) {
  try {
    const lane = normalizeRuntimeLane(rawLane);
    const signals = await runFrictionRadar({
      cwd: process.cwd(),
      runtimeLane: lane,
      toolMode: getToolMode(),
    });
    console.log(cliPage({ title: "Friction Radar", state: `${signals.length} signal${signals.length === 1 ? "" : "s"}`, body: formatFrictionRadar(signals), next: "switchbay handoff" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay radar: ${msg}`);
    process.exit(1);
  }
}

async function runHandoffCommand() {
  try {
    console.log(cliPage({ title: "Session Handoff", state: "Ready", body: await buildQuickHandoff({ cwd: process.cwd() }), next: "switchbay --new" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay handoff: ${msg}`);
    process.exit(1);
  }
}

async function runMcpCommand(action: "status" | "init" | "catalog") {
  try {
    const cwd = process.cwd();
    if (action === "init") {
      const path = await saveSwitchbayMcpConfig(createDefaultSwitchbayMcpConfig(), cwd);
      console.log(cliReceipt("MCP Bridge", "Configuration created", [["Location", path.replace(process.env.HOME ?? "", "~")]], "switchbay mcp status"));
      return;
    }
    if (action === "catalog") {
      console.log(cliPage({ title: "Trusted MCP Catalog", state: "Available bridges", body: describeTrustedMcpCatalog(), next: "switchbay mcp init" }));
      return;
    }

    const status = await loadSwitchbayMcpConfig(cwd);
    console.log(cliPage({
      title: "MCP Bridge", state: !status.exists ? "Not configured" : status.config.enabled === false ? "Disabled" : "Ready",
      summary: "External tool servers available through Switchbay's guarded runtime.",
      rows: [["Config", status.path.replace(process.env.HOME ?? "", "~")], ["Servers", String(status.integrations.length)], ["Policy", status.exists && status.config.enabled !== false ? "Enabled" : status.exists ? "Disabled" : "Awaiting setup"]],
      next: status.exists ? "switchbay mcp catalog" : "switchbay mcp init",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("MCP Bridge", msg, ["switchbay mcp status"]));
    process.exit(1);
  }
}

async function runUpdateCommand() {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { writeFile, chmod } = await import("node:fs/promises");
  const { runCommand } = await import("./src/tools/shell");

  // Use import.meta.dir to find the actual repo root (where index.tsx lives),
  // not process.cwd() which is wherever the user ran `switchbay update` from.
  const repoDir = import.meta.dir;
  const isGit = existsSync(join(repoDir, ".git"));

  if (isGit) {
    console.log(`${CLR.accent}⏺${CLR.reset} ${CLR.bold}Switchbay Git Updater${CLR.reset}`);
    console.log("Updating from local git repository...");

    // 0. Check for uncommitted changes
    const gitStatus = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: repoDir });
    const hasUncommitted = gitStatus.stdout.toString().trim().length > 0;

    if (hasUncommitted) {
      console.log(`\n${CLR.accent}⚠${CLR.reset} ${CLR.bold}You have uncommitted local changes.${CLR.reset}`);
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const comment = await new Promise<string>((resolve) => {
        rl.question("Enter commit message for your changes (or press Enter to skip commit): ", resolve);
      });
      rl.close();

      if (comment.trim()) {
        console.log("Adding and committing changes...");
        const gitAdd = Bun.spawn(["git", "add", "."], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        await gitAdd.exited;

        const gitCommit = Bun.spawn(["git", "commit", "-m", comment.trim()], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        await gitCommit.exited;
      } else {
        console.log("Skipping commit. Proceeding with update...");
      }
    }

    // Check for unpushed commits
    const branchResult = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: repoDir });
    const branchName = branchResult.stdout.toString().trim();

    if (branchName) {
      const upstreamResult = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "@{u}"], { cwd: repoDir });
      const hasUpstream = upstreamResult.exitCode === 0;

      let hasUnpushed = false;
      if (hasUpstream) {
        const unpushedResult = Bun.spawnSync(["git", "log", "@{u}..HEAD", "--oneline"], { cwd: repoDir });
        hasUnpushed = unpushedResult.stdout.toString().trim().length > 0;
      } else {
        hasUnpushed = true;
      }

      if (hasUnpushed) {
        console.log("Pushing local commits to remote...");
        const pushArgs = hasUpstream ? ["git", "push"] : ["git", "push", "-u", "origin", branchName];
        const gitPush = Bun.spawn(pushArgs, { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
        const pushCode = await gitPush.exited;
        if (pushCode !== 0) {
          console.warn(`${CLR.error}Warning: git push failed. Proceeding with update...${CLR.reset}`);
        }
      }
    }

    // 1. git pull
    console.log("Running git pull...");
    const gitPull = Bun.spawn(["git", "pull"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const pullCode = await gitPull.exited;
    if (pullCode !== 0) {
      console.error(`${CLR.error}git pull failed with exit code ${pullCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 2. bun install
    console.log("Running bun install...");
    const bunInstall = Bun.spawn(["bun", "install"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const installCode = await bunInstall.exited;
    if (installCode !== 0) {
      console.error(`${CLR.error}bun install failed with exit code ${installCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 3. bun run build
    console.log("Building Switchbay...");
    const bunBuild = Bun.spawn(["bun", "run", "build"], { cwd: repoDir, stdout: "inherit", stderr: "inherit" });
    const buildCode = await bunBuild.exited;
    if (buildCode !== 0) {
      console.error(`${CLR.error}bun run build failed with exit code ${buildCode}.${CLR.reset}`);
      process.exit(1);
    }

    // 4. Update the service
    console.log("Reinstalling macOS service...");
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand("install"));

    // 5. Try linking the global CLI to this repository
    console.log("Updating global CLI command to point to this repository...");
    try {
      const activeCli = await runCommand(["which", "switchbay"]);
      if (activeCli.ok && activeCli.stdout?.trim()) {
        const cliPath = activeCli.stdout.trim();
        // Always point the shim at the repo's index.tsx, not wherever the user ran the command from
        const content = `#!/bin/bash\nexec bun "${join(repoDir, "index.tsx")}" "$@"\n`;
        await writeFile(cliPath, content);
        await chmod(cliPath, 0o755);
        console.log(`Linked global CLI command at ${cliPath} to ${join(repoDir, "index.tsx")}`);
      } else {
        console.log("No global `switchbay` command found in PATH to link.");
      }
    } catch (err: any) {
      console.log(`Note: Could not link global CLI path (run with sudo or check permissions if needed): ${err.message}`);
    }

    console.log(`\n${CLR.accent}⏺${CLR.reset} ${CLR.bold}Update successful!${CLR.reset}`);
    return;
  }

  // Not a git repo - update via Homebrew
  console.log(`${CLR.accent}⏺${CLR.reset} ${CLR.bold}Switchbay Homebrew Updater${CLR.reset}`);
  console.log("Checking for updates via Homebrew...");

  console.log("Running brew update...");
  const brewUpdate = Bun.spawn(["brew", "update"], { stdout: "inherit", stderr: "inherit" });
  const updateCode = await brewUpdate.exited;
  if (updateCode !== 0) {
    console.error(`${CLR.error}brew update failed with exit code ${updateCode}.${CLR.reset}`);
    process.exit(1);
  }

  console.log("Running brew upgrade switchbay...");
  const brewUpgrade = Bun.spawn(["brew", "upgrade", "switchbay"], { stdout: "inherit", stderr: "inherit" });
  const upgradeCode = await brewUpgrade.exited;
  if (upgradeCode !== 0) {
    console.log("brew upgrade finished or already up-to-date.");
  }

  // Restart/reinstall the daemon
  console.log("Rebuilding and restarting Switchbay macOS service...");
  try {
    const { runServiceCommand } = await import("./src/service/macos");
    console.log(await runServiceCommand("install"));
  } catch (err: any) {
    console.error(`Failed to reinstall background service: ${err.message}`);
  }

  console.log(`\n${CLR.accent}⏺${CLR.reset} ${CLR.bold}Update completed!${CLR.reset}`);
}

function runLocalModeCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const normalized = target?.trim().toLowerCase();
    if (normalized !== "off" && normalized !== "local" && normalized !== "offline") {
      console.error(`switchbay local-mode: choose off, local, or offline.`);
      console.error(`  switchbay local-mode set local     # local inference, web tools on`);
      console.error(`  switchbay local-mode set offline   # local inference, no network tools`);
      console.error(`  switchbay local-mode set off       # restore default routing`);
      process.exit(1);
    }
    setLocalMode(normalized as LocalMode);
    const label = normalized === "off" ? "Default routing restored" : normalized === "offline" ? "Offline mode — local inference + no network tools" : "Local mode — local inference, web tools enabled";
    console.log(cliReceipt("Local Mode", label, [["Config", "~/.switchbay/config.json"], ["Override", "SWITCHBAY_LOCAL_MODE=<mode>"]], "switchbay local-mode"));
    return;
  }
  const current = getLocalMode();
  const stateLabel = current === "off" ? "off (default routing)" : current === "offline" ? "offline (local inference · no network tools)" : "local (local inference · web tools on)";
  console.log(cliPage({
    title: "Local Mode",
    state: stateLabel,
    summary: current === "off"
      ? "All lanes available. Set to local or offline to restrict routing."
      : current === "offline"
        ? "Air-gap mode. Inference stays on-device. Web tools are disabled."
        : "Local-first mode. Cloud escalation requires confirmation per task.",
    rows: [
      ["off", "Default — all lanes, no restrictions"],
      ["local", "Local inference · web tools enabled · cloud needs confirm"],
      ["offline", "Local inference · web tools disabled · cloud blocked"],
    ],
    next: "switchbay local-mode set <off|local|offline>",
  }));
}

async function runLocalProviderCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const provider = normalizeLocalProvider(target);
    if (!provider) {
      console.error("switchbay local-provider: set requires `ollama`.");
      process.exit(1);
    }
    setActiveLocalProvider(provider);
    console.log(cliReceipt("Local Runtime", `Provider set to ${provider}`, [], "switchbay local-provider"));
    return;
  }
  const config = loadLocalProvidersConfig();
  console.log(cliPage({ title: "Local Runtime", state: getActiveLocalProvider(), summary: "Private and contained model execution.", rows: Object.values(config.providers).map((provider) => [provider.label, `${provider.id === config.active ? "● active" : "○ available"} · ${provider.model ?? "automatic"}`] as [string, string]), next: "switchbay models --lane local" }));
}

async function runCloudProviderCommand(action: "status" | "set", target: string | null) {
  if (action === "set") {
    const provider = normalizeCloudProvider(target);
    if (!provider) {
      console.error(cliFailure("Cloud Runtime", "Choose auto, openai, anthropic, or gemini.", ["switchbay cloud-provider set auto"]));
      process.exit(1);
    }
    setActiveCloudProvider(provider);
    console.log(cliReceipt("Cloud Runtime", `Routing set to ${provider === "google" ? "gemini" : provider}`, [], "switchbay models --lane cloud"));
    return;
  }
  const config = loadCloudProvidersConfig();
  const pool = listAutoModelPool();
  console.log(cliPage({ title: "Cloud Runtime", state: getActiveCloudProvider(), summary: `Trusted pool: ${pool.length} verified model(s)`, rows: pool.length ? pool.map((entry) => [entry.lane, `${entry.status === "ready" ? "● ready" : `○ ${entry.status}`} · ${entry.model}`]) : [["pool", "Empty — add and verify models with: switchbay model add <id>"]], next: "switchbay models --lane cloud" }));
}

async function runBriefCommand(action: "list" | "create" | "draft", name: string | null, prompt: string | null, lane: string | null) {
  const cwd = process.cwd();

  if (action === "list") {
    const docs = await listCanvasDocs(cwd);
    if (!docs.length) {
      console.log(cliPage({ title: "Brief", state: "No documents", body: "No briefs yet in this workspace.\n\nCreate one:\n  switchbay brief create \"My Document\"\n  switchbay brief draft \"Write a product brief for X\" --name \"Product Brief\"" }));
      return;
    }
    const rows = docs.map((doc) => [doc.file, `${doc.name}  ·  ${doc.size} bytes  ·  ${doc.updatedAt.slice(0, 10)}`]);
    console.log(cliPage({ title: "Brief", state: `${docs.length} document${docs.length === 1 ? "" : "s"}`, rows, next: "switchbay open  (view in workspace)" }));
    return;
  }

  if (action === "create") {
    if (!name?.trim()) {
      console.log(cliFailure("brief create requires a document name.\n\nUsage: switchbay brief create \"My Document\""));
      return;
    }
    const file = await createCanvasDoc(cwd, name.trim());
    console.log(cliReceipt(`Brief created: ${file}`, undefined, [["file", file], ["workspace", cwd]], "switchbay open  (view in Brief)"));
    return;
  }

  if (action === "draft") {
    if (!prompt?.trim()) {
      console.log(cliFailure("brief draft requires a prompt", "Usage: switchbay brief draft \"Write a product brief for...\" --name \"My Doc\""));
      return;
    }
    const docName = name?.trim() || prompt.trim().slice(0, 60);
    const file = await createCanvasDoc(cwd, docName);
    console.log(`  ${CLR.muted}◆ Brief created: ${file} — drafting…${CLR.reset}`);

    // Run a real turn so the AI drafts the document
    const runtimeLane = normalizeRuntimeLane(lane);
    const client = createRuntimeClient(runtimeLane);
    const workspace = await (await import("./src/session/workspace")).loadWorkspaceSnapshot(cwd);
    const fullPrompt = `Use the brief-draft skill. Draft a Brief document.\n\nFile: ${file}\nTopic: ${prompt.trim()}\n\nUse edit_canvas with file="${file}" and op="replace_all" to write the full draft.`;
    const turn = await buildTurn({ input: fullPrompt, mode: "build", profile: "switchbay", transcript: [], workspace, runtimeLane, toolMode: getToolMode() });
    const executed = await executeTurn({ client, cwd, sessionId: crypto.randomUUID(), surface: "cli", turn, workspace });
    const content = extractAssistantText(executed.response);
    if (content) console.log(`\n  ${content}\n`);
    console.log(cliReceipt(`Brief drafted: ${file}`, undefined, [["file", file], ["workspace", cwd]], "switchbay open  (view in Brief)"));
  }
}

async function runModelsAllCommand() {
  type LaneEntry = { rawLane: string; label: string; localProvider?: string };
  const LANES: LaneEntry[] = [
    { rawLane: "cloud",       label: "Cloud (Auto Pool)" },
    { rawLane: "openai",      label: "Cloud · OpenAI" },
    { rawLane: "anthropic",   label: "Cloud · Anthropic" },
    { rawLane: "google",      label: "Cloud · Google" },
    { rawLane: "apple",       label: "Apple Intelligence" },
    { rawLane: "local",       label: "Local (Ollama)" },
    { rawLane: "local",       label: "Local (llama.cpp)", localProvider: "llama-cpp" },
    { rawLane: "local",       label: "Local (MLX)",       localProvider: "mlx" },
    { rawLane: "litert",      label: "LiteRT-LM (Google Edge)" },
    { rawLane: "openrouter",  label: "OpenRouter" },
    { rawLane: "huggingface", label: "Hugging Face" },
  ];

  const { normalizeRuntimeLane } = await import("./src/config/env");
  const { normalizeLocalProvider, getActiveLocalProvider } = await import("./src/runtime/local-providers");
  const { normalizeCloudProvider, listAutoModelPool } = await import("./src/runtime/cloud-providers");
  const { cliHeader } = await import("./src/cli/presentation");

  console.log(cliHeader("All Model Lanes", "switchbay models list --all", cliColorEnabled()));
  console.log("");

  for (const { rawLane, label, localProvider: overrideProvider } of LANES) {
    let models: RuntimeModelOption[] = [];
    let notice: string | undefined;
    try {
      if (rawLane === "litert") {
        const { liteRtServerModels, isLiteRtServerRunning, LITERT_PORT } = await import("./src/runtime/litert-lm");
        console.log(`  ── ${label} ${"─".repeat(Math.max(0, 50 - label.length - 4))}`);
        const running = await isLiteRtServerRunning();
        if (!running) {
          console.log(`     Not connected`);
        } else {
          const serverModels = await liteRtServerModels();
          if (serverModels.length === 0) {
            console.log(`     Not connected`);
          } else {
            for (const m of serverModels.slice(0, 6)) {
              console.log(`     ${m.id.padEnd(36)} litert-lm`);
            }
            if (serverModels.length > 6) console.log(`     … and ${serverModels.length - 6} more`);
          }
        }
        console.log("");
        continue;
      }
      if (rawLane === "cloud") {
        const pool = listAutoModelPool();
        console.log(`  ── ${label} ${"─".repeat(Math.max(0, 50 - label.length - 4))}`);
        if (pool.length === 0) {
          console.log("     (empty — add verified models with: switchbay model add <id>)");
        } else {
          for (const entry of pool.slice(0, 6)) {
            console.log(`     ${entry.status === "ready" ? "●" : "○"} ${entry.model.padEnd(36)} ${entry.lane}`);
          }
          if (pool.length > 6) console.log(`     … and ${pool.length - 6} more`);
        }
        console.log("");
        continue;
      }
      const lane = normalizeRuntimeLane(rawLane);
      const localProvider = overrideProvider
        ? (normalizeLocalProvider(overrideProvider) ?? getActiveLocalProvider())
        : (normalizeLocalProvider(rawLane) ?? getActiveLocalProvider());
      const cloudProvider = normalizeCloudProvider(rawLane);
      const result = await listRuntimeModels(lane, localProvider ?? undefined);
      models = cloudProvider && cloudProvider !== "auto"
        ? result.models.filter((m) => m.provider === cloudProvider)
        : result.models.filter((m) => m.id !== "auto");
      notice = result.notice;
    } catch {
      notice = "Could not reach this lane.";
    }

    console.log(`  ── ${label} ${"─".repeat(Math.max(0, 50 - label.length - 4))}`);
    if (models.length === 0) {
      console.log(`     ${notice ?? "(no models)"}`);
    } else {
      for (const m of models.slice(0, 6)) {
        console.log(`     ${m.id.padEnd(36)} ${m.provider}`);
      }
      if (models.length > 6) console.log(`     … and ${models.length - 6} more`);
    }
    console.log("");
  }

  console.log("  Drill in: switchbay models --lane <lane>");
  console.log("");
}

async function runModelsCommand(rawLane: string | null, action: "list" | "clear" | "verify" = "list", all = false, trustedOnly = false, providerFilter: string | null = null) {
  if (action === "verify") {
    const catalog = loadCloudModelCatalog();
    const models = catalog.models;
    if (!models.length) {
      process.stdout.write(`${CLR.muted}Cloud model catalog is empty. Add a model: switchbay model add <id>${CLR.reset}\n`);
      return;
    }
    process.stdout.write(`\n${CLR.bold}Model Verify${CLR.reset}  ${CLR.muted}${models.length} model${models.length === 1 ? "" : "s"}${CLR.reset}\n\n`);
    let verified = 0;
    let failed = 0;
    for (const model of models) {
      const label = `${model.provider}/${model.id}`;
      process.stdout.write(`  ${CLR.muted}·${CLR.reset}  ${label}\n`);
      try {
        const result = await reverifyCloudModel(model.id, model.provider);
        if (result.verified) {
          process.stdout.write(`\x1b[1A\x1b[2K  ${CLR.accent}✓${CLR.reset}  ${label}\n`);
          verified++;
        } else {
          const notice = result.notice ? `  ${CLR.muted}${result.notice}${CLR.reset}` : "";
          process.stdout.write(`\x1b[1A\x1b[2K  \x1b[31m✗\x1b[0m  ${label}${notice}\n`);
          failed++;
        }
      } catch (err: any) {
        const msg = err.message ?? String(err);
        process.stdout.write(`\x1b[1A\x1b[2K  \x1b[31m✗\x1b[0m  ${label}  ${CLR.muted}${msg}${CLR.reset}\n`);
        failed++;
      }
    }
    process.stdout.write(`\n  ${CLR.muted}${verified}/${models.length} verified${failed > 0 ? ` · ${failed} failed` : ""}${CLR.reset}\n\n`);
    return;
  }
  if (action === "list" && all) {
    await runModelsAllCommand();
    return;
  }
  if (action === "clear") {
    const providerToClear = providerFilter ? normalizeCloudModelProviderOrNull(providerFilter) : null;
    if (providerToClear) {
      const result = removeCloudModelsByProvider(providerToClear);
      console.log(cliReceipt(
        "Cloud Model Catalog",
        result.removed === 0 ? `No ${providerToClear} models to clear` : `Cleared ${result.removed} ${providerToClear} model(s)`,
        [["Catalog", "~/.switchbay/cloud-models.json"]],
        "switchbay models --lane cloud",
      ));
    } else {
      const result = clearCloudModelCatalog();
      console.log(cliReceipt(
        "Cloud Model Catalog",
        result.removed === 0 ? "Already empty" : `Cleared ${result.removed} model(s)`,
        [["Catalog", "~/.switchbay/cloud-models.json"]],
        "switchbay models --lane cloud",
      ));
    }
    return;
  }
  // Edge / LiteRT provider — intercept before generic lane resolution
  const isLiteRtRequest = (rawLane && /^(litert|litert-lm|edge|google-edge)$/i.test(rawLane))
    || (providerFilter && /^(litert|litert-lm|edge|google-edge)$/i.test(providerFilter));
  if (isLiteRtRequest) {
    const { liteRtServerModels, isLiteRtServerRunning, liteRtLocalList, LITERT_PORT, KNOWN_LITERT_MODELS } = await import("./src/runtime/litert-lm");
    const running = await isLiteRtServerRunning();
    const serverModels = running ? await liteRtServerModels() : [];
    const { ok, output } = await liteRtLocalList();
    const localLines = ok ? output.trim().split("\n").filter(Boolean) : [];
    const rows: [string, string][] = [];
    if (serverModels.length) {
      for (const m of serverModels) rows.push(["loaded", m.id]);
    }
    if (localLines.length) {
      for (const l of localLines) rows.push(["local", l]);
    }
    if (!rows.length) {
      for (const m of KNOWN_LITERT_MODELS) rows.push(["catalog", `${m.id}  ·  ${m.description}`]);
    }
    const state = running ? `Server on :${LITERT_PORT}` : "Server not running";
    console.log(cliPage({
      title: "LiteRT-LM (Google Edge)",
      state,
      summary: running
        ? `${serverModels.length} model${serverModels.length === 1 ? "" : "s"} loaded · use switchbay litert list for local registry`
        : "Start server: switchbay litert serve · import a model: switchbay litert import",
      rows,
      next: running ? "switchbay litert stop" : "switchbay litert serve",
    }));
    return;
  }

  const lane = normalizeRuntimeLane(rawLane);
  const localProvider = normalizeLocalProvider(rawLane) ?? undefined;
  try {
    const selected = getSelectedRuntimeModel(lane);
    const result = await listRuntimeModels(lane, localProvider);
    const requestedCloudProvider = normalizeCloudProvider(rawLane);
    const activeCloudProvider = requestedCloudProvider ?? getActiveCloudProvider();
    const resolvedProviderFilter = providerFilter ? normalizeCloudModelProviderOrNull(providerFilter) : null;
    const visibleModels = (() => {
      let models = result.models;
      if (lane === "cloud" && activeCloudProvider !== "auto") models = models.filter((m) => m.provider === activeCloudProvider);
      if (resolvedProviderFilter) models = models.filter((m) => m.provider === resolvedProviderFilter);
      return models;
    })();
    if (lane === "cloud" && activeCloudProvider === "auto") {
      const pool = listAutoModelPool();
      console.log(`${renderCliList({
        title: "Trusted Auto Pool",
        count: pool.length,
        noun: "model",
        summary: pool.length ? `${pool.filter((entry) => entry.status === "ready").length}/${pool.length} ready` : "Empty — add verified models to populate",
        columns: [
          { key: "lane", label: "Provider", width: 12 },
          { key: "model", label: "Model", width: 38 },
          { key: "status", label: "Status", width: 14 },
          { key: "verifiedAt", label: "Verified", width: 24 },
        ],
        rows: pool,
        empty: "No verified models. Use: switchbay model add <id>",
        hint: "Trusted local: ollama · Explicit-only: openrouter, huggingface, ollama-cloud",
      })}\n`);
    }
    const isCloudLane = lane === "cloud" || lane === "cloud-mcp";
    const catalogIndex = isCloudLane
      ? new Map(loadCloudModelCatalog().models.map((m) => [`${m.provider}:${m.id}`, m]))
      : new Map();
    const gradeIndex = isCloudLane
      ? new Map(getAllGrades().map((g) => [`${g.provider}:${g.modelId}`, g]))
      : new Map();
    let displayModels = visibleModels;
    if (trustedOnly && isCloudLane) {
      displayModels = visibleModels.filter((m) => {
        const g = gradeIndex.get(`${m.provider}:${m.id}`);
        return g ? isTrusted(g) : false;
      });
    }
    console.log(renderCliList({
      title: `${getRuntimeLaneLabel(lane)} Models${resolvedProviderFilter ? ` · ${resolvedProviderFilter}` : ""}${trustedOnly ? " · Trusted" : ""}`,
      count: displayModels.length,
      noun: "model",
      summary: lane === "cloud"
        ? `${displayModels.length} shown · mode=${activeCloudProvider}${resolvedProviderFilter ? ` · provider=${resolvedProviderFilter}` : ""}${trustedOnly ? " · A/B grade only" : ""}`
        : `${displayModels.length} available`,
      columns: [
        { key: "active", label: "", width: 2 },
        { key: "id", label: "Model", width: 34 },
        { key: "provider", label: "Provider", width: 12 },
        { key: "source", label: "Source", width: 10 },
        ...(isCloudLane ? [{ key: "grade", label: "Grade", width: 6 }, { key: "status", label: "Status", width: 12 }] : []),
      ],
      rows: displayModels.map((model) => {
        let status: string | undefined;
        let grade: string | undefined;
        if (isCloudLane) {
          const catalogEntry = catalogIndex.get(`${model.provider}:${model.id}`);
          const gradeEntry = gradeIndex.get(`${model.provider}:${model.id}`);
          status = model.source === "custom" ? (catalogEntry?.verifiedAt ? "Verified" : "Custom") : model.source === "preset" ? "Preset" : "—";
          grade = gradeEntry ? gradeEntry.grade : "—";
        }
        return { active: selected?.id === model.id ? "●" : "", id: model.id, provider: model.provider, source: model.source, ...(isCloudLane ? { grade, status } : {}) };
      }),
      empty: trustedOnly ? "No trusted (A/B) models found. Run: switchbay benchmark --pre" : "No models found for this lane.",
      hint: trustedOnly ? "Run pre-bench: switchbay benchmark --pre" : `Switch: switchbay model ${lane} <model-id>`,
    }));
    if (selected && !visibleModels.some((model) => model.id === selected.id)) {
      console.log(`\nSelected: ${selected.id} (not returned by the current model list)`);
    }
    if (result.notice) console.log(`\n${result.notice}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay models: ${msg}`);
    process.exit(1);
  }
}

async function runModelCommand(
  rawLane: string | null,
  rawModelLane: string | null,
  target: string | null,
  action: "show" | "set" | "pull" | "add" | "remove" | "verify",
  quantization: string | null,
  label: string | null,
  yes = false,
) {
  const lane = normalizeRuntimeLane(rawModelLane ?? rawLane);
  if (action === "pull") {
    await runModelPullCommand(rawModelLane ?? rawLane, target, quantization, yes);
    return;
  }

  if (action === "add") {
    await runModelAddCommand(rawModelLane ?? rawLane, target, label, yes);
    return;
  }

  if (action === "remove") {
    await runModelRemoveCommand(rawModelLane ?? rawLane, target);
    return;
  }

  if (action === "verify") {
    await runModelVerifyCommand(rawModelLane ?? rawLane, target);
    return;
  }

  if (!target) {
    const selected = getSelectedRuntimeModel(lane);
    console.log(cliPage({ title: "Model Runtime", state: getRuntimeLaneLabel(lane), rows: [["Selection", selected?.id ?? "Auto"], ["Mode", selected ? "Pinned" : "Automatic"]], next: `switchbay models --lane ${lane}` }));
    return;
  }

  try {
    const result = await listRuntimeModels(lane);
    const match = findRuntimeModel(result.models, target);
    if (!match) {
      console.error(cliFailure(
        "Model not found",
        `${target} is not available on the ${getRuntimeLaneLabel(lane)} lane.`,
        result.models.length
          ? [`Available: ${result.models.slice(0, 6).map((m) => m.id).join(", ")}${result.models.length > 6 ? ` +${result.models.length - 6} more` : ""}`, "switchbay models --lane " + lane]
          : ["switchbay models --lane " + lane],
      ));
      process.exit(1);
    }

    if (match.provider === "auto") {
      clearSelectedRuntimeModel(lane);
      setActiveCloudProvider("auto");
      console.log(cliReceipt("Model Runtime", "Trusted auto-routing active", [["Lane", getRuntimeLaneLabel(lane)]], `switchbay models --lane ${lane}`));
      return;
    }

    setSelectedRuntimeModel(lane, {
      id: match.id,
      provider: match.provider,
    });
    console.log(cliReceipt("Model Runtime", "Model pinned", [["Lane", getRuntimeLaneLabel(lane)], ["Model", match.id], ["Config", "~/.switchbay/config.json"]], `switchbay model ${lane} auto`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model: ${msg}`);
    process.exit(1);
  }
}

async function runModelAddCommand(rawLane: string | null, target: string | null, label: string | null, yes = false) {
  const provider = normalizeCloudModelProvider(rawLane, target);
  const modelId = isCloudProviderAlias(target) ? null : target;
  if (!modelId?.trim()) {
    console.error("switchbay model add: requires a cloud model id.");
    console.error("Example: switchbay model add openai gpt-5.5");
    console.error("Example: switchbay --lane cloud --add-model gpt-5.5");
    process.exit(1);
  }

  try {
    process.stdout.write(`Verifying ${provider}/${modelId}... `);
    const verification = await verifyCloudModel(modelId, provider);

    if (verification.ok) {
      process.stdout.write("✓\n");
    } else {
      process.stdout.write("✗\n");
      if (verification.notice) {
        console.log(`\n  ${verification.notice}`);
      }

      // Gate on explicit API rejection (model doesn't exist on account).
      // Timeouts, missing keys, and network errors are config gaps — warn and proceed silently.
      if (verification.reason === "not_found" && !yes) {
        console.log("");
        const proceed = await confirm("  Add it anyway?");
        if (!proceed) {
          console.log("  Aborted.");
          process.exit(0);
        }
        console.log("");
      }
    }

    const result = await addCloudModel({ id: modelId, label, provider, verify: false });
    // Stamp verifiedAt manually if we already confirmed it above
    if (verification.ok) {
      const { saveCloudModelCatalog, loadCloudModelCatalog: reloadCatalog } = await import("./src/runtime/cloud-model-catalog");
      const catalog = reloadCatalog();
      const now = new Date().toISOString();
      const models = catalog.models.map((m) =>
        m.id === modelId && m.provider === provider ? { ...m, verifiedAt: now } : m
      );
      saveCloudModelCatalog({ models });
    }

    setSelectedRuntimeModel("cloud", { id: result.model.id, provider: result.model.provider });
    console.log(cliReceipt(
      "Cloud Model Catalog",
      `Added ${result.model.id}`,
      [
        ["Provider", result.model.provider],
        ["Status", verification.ok ? "Verified" : "Unverified (custom)"],
        ["Catalog", "~/.switchbay/cloud-models.json"],
      ],
      `switchbay models --lane cloud`,
    ));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`switchbay model add: ${msg}`);
    process.exit(1);
  }
}

async function runModelVerifyCommand(rawLane: string | null, target: string | null) {
  const catalog = loadCloudModelCatalog();

  // No target — re-verify every custom model in the catalog
  if (!target?.trim()) {
    if (!catalog.models.length) {
      console.log("Cloud model catalog is empty. Add a model with: switchbay model add <model-id>");
      return;
    }
    console.log(`Verifying ${catalog.models.length} model(s)...`);
    let verified = 0;
    let failed = 0;
    for (const model of catalog.models) {
      process.stdout.write(`  ${model.provider}/${model.id} ... `);
      try {
        const result = await reverifyCloudModel(model.id, model.provider);
        if (result.verified) {
          process.stdout.write("✓\n");
          verified++;
        } else {
          const detail = result.notice ? `  ${result.notice}` : "not verified";
          process.stdout.write(`✗  ${detail}\n`);
          failed++;
        }
      } catch (err: any) {
        process.stdout.write(`✗  ${err.message}\n`);
        failed++;
      }
    }
    console.log(`\n  ${verified} verified, ${failed} failed.`);
    return;
  }

  // Target provided — verify a specific model
  const provider = normalizeCloudModelProvider(rawLane, target);
  const modelId = isCloudProviderAlias(target) ? null : target;
  if (!modelId?.trim()) {
    console.error("switchbay model verify: requires a cloud model id.");
    console.error("Example: switchbay model verify gpt-5.5");
    console.error("Example: switchbay model verify openai gpt-5.5");
    process.exit(1);
  }

  const entry = catalog.models.find((m) => m.id === modelId && m.provider === provider);
  if (!entry) {
    console.error(`switchbay model verify: ${modelId} (${provider}) is not in the catalog.`);
    console.error("Add it first: switchbay model add " + modelId);
    process.exit(1);
  }

  process.stdout.write(`Verifying ${provider}/${modelId}... `);
  try {
    const result = await reverifyCloudModel(modelId, provider);
    if (result.verified) {
      process.stdout.write("✓\n");
      console.log(cliReceipt("Model Verified", `${provider}/${modelId}`, [], "switchbay models --lane cloud"));
    } else {
      process.stdout.write("✗\n");
      if (result.notice) console.log(`\n  ${result.notice}`);
      console.log(`\n  Status updated in catalog.`);
    }
  } catch (err: any) {
    process.stdout.write("✗\n");
    console.error(`\n  ${err.message}`);
    process.exit(1);
  }
}

async function runModelRemoveCommand(rawLane: string | null, target: string | null) {
  // `remove --lane {provider}` with no target — bulk remove all models for that provider
  const laneAsProvider = rawLane ? normalizeCloudModelProviderOrNull(rawLane) : null;
  if (!target?.trim() && laneAsProvider) {
    const { removed } = removeCloudModelsByProvider(laneAsProvider);
    if (!removed) {
      console.log(cliReceipt("Cloud Model Catalog", `No ${laneAsProvider} models to remove`, [], "switchbay models --lane cloud"));
      return;
    }
    console.log(cliReceipt(
      "Cloud Model Catalog",
      `Removed ${removed} ${laneAsProvider} model${removed === 1 ? "" : "s"}`,
      [["Catalog", "~/.switchbay/cloud-models.json"]],
      "switchbay models --lane cloud",
    ));
    return;
  }

  const provider = isCloudProviderAlias(target) ? null : normalizeCloudModelProvider(rawLane, target);
  const modelId = isCloudProviderAlias(target) ? null : target;
  if (!modelId?.trim()) {
    console.error("switchbay model remove: requires a model id or --lane to bulk remove.");
    console.error("Example: switchbay model remove gpt-5.5");
    console.error("Example: switchbay model remove --lane openai");
    process.exit(1);
  }

  try {
    const result = removeCloudModel(modelId, provider);
    if (!result.removed) {
      console.error(cliFailure(
        "Model not found",
        `${modelId} is not in the cloud catalog.`,
        ["switchbay models --lane cloud"],
      ));
      process.exit(1);
    }
    console.log(cliReceipt(
      "Cloud Model Catalog",
      `Removed ${modelId}`,
      [["Catalog", "~/.switchbay/cloud-models.json"]],
      "switchbay models --lane cloud",
    ));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Model Remove Failed", msg));
    process.exit(1);
  }
}

function normalizeCloudModelProvider(rawLane: string | null, target: string | null): CloudProviderId {
  const alias = rawLane?.toLowerCase();
  if (alias === "openai" || alias === "open-ai" || alias === "gpt") return "openai";
  if (alias === "anthropic" || alias === "claude") return "anthropic";
  if (alias === "google" || alias === "gemini") return "google";
  return inferCloudModelProvider(target ?? "");
}

function normalizeCloudModelProviderOrNull(raw: string): CloudProviderId | null {
  const alias = raw.toLowerCase();
  if (alias === "openai" || alias === "open-ai" || alias === "gpt") return "openai";
  if (alias === "anthropic" || alias === "claude") return "anthropic";
  if (alias === "google" || alias === "gemini") return "google";
  return null;
}

function isCloudProviderAlias(value: string | null): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "openai" ||
    normalized === "open-ai" ||
    normalized === "gpt" ||
    normalized === "anthropic" ||
    normalized === "claude" ||
    normalized === "google" ||
    normalized === "gemini";
}

async function runModelPullCommand(rawLane: string | null, target: string | null, quantization: string | null, yes = false) {
  if (!target?.trim()) {
    console.error(cliFailure(
      "Missing model id",
      "switchbay model pull requires a model id or Hugging Face repo.",
      [
        "switchbay model pull llama3.2                              (Ollama)",
        "switchbay model pull ibm/granite-4-micro                   (Ollama ← HF)",
        "switchbay model pull apple/OpenELM-3B-Instruct --provider mlx  (MLX, on-device)",
        "switchbay model pull Qwen/Qwen2.5-3B-Instruct --provider llama-cpp  (GGUF)",
      ],
    ));
    process.exit(1);
  }

  // Dispatch to HF-local providers when --provider or active provider is llama-cpp/mlx
  const { normalizeLocalProvider, getActiveLocalProvider } = await import("./src/runtime/local-providers");
  const explicitProvider = rawLane ? normalizeLocalProvider(rawLane) : null;
  const activeProvider = explicitProvider ?? getActiveLocalProvider();
  if (activeProvider === "llama-cpp" || activeProvider === "mlx") {
    await runHfLocalPullCommand(target.trim(), activeProvider, yes);
    return;
  }

  try {
    const { normalizeOllamaHuggingFaceModel, pullOllamaModel } = await import("./src/runtime/models");
    const targetModel = normalizeOllamaHuggingFaceModel(target, quantization);

    // HuggingFace models are arbitrary weights — show a caution before pulling
    if (targetModel.startsWith("hf.co/") && !yes) {
      console.log("\n" + cliPage({
        title: "HuggingFace Model",
        state: "community weights",
        rows: [
          ["Model",  targetModel],
          ["Source", "hf.co — not curated or audited"],
          ["Note",   "Anyone can upload weights under any name. Only pull from authors you trust."],
        ],
      }));
      const proceed = await confirm("  Pull this model anyway?");
      if (!proceed) {
        console.log("  Aborted.");
        process.exit(0);
      }
      console.log("");
    }

    console.log(`\n  Pulling ${targetModel} through Ollama…`);
    try {
      let lastPercent = -1;
      const result = await pullOllamaModel({
        model: targetModel,
        onProgress: (progress) => {
          if (progress.completed !== undefined && progress.total !== undefined && progress.total > 0) {
            const percent = Math.floor((progress.completed / progress.total) * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              process.stdout.write(`\r  Pulling… ${percent}%  (${progress.status})`);
            }
          } else {
            process.stdout.write(`\r  Pulling… ${progress.status}`);
          }
        }
      });
      process.stdout.write("\n");
      setSelectedRuntimeModel("local", { id: result.model, provider: "ollama" });
      setActiveLocalProvider("ollama");
      console.log(cliReceipt(
        "Local Model",
        result.status ?? "Pulled",
        [["Model", result.model], ["Provider", "Ollama"], ["Lane", "local"]],
        "switchbay model",
      ));
    } catch (error: any) {
      const msg: string = error?.message ?? String(error);
      const notGguf = /not GGUF|not compatible with llama\.cpp/i.test(msg);
      if (notGguf) {
        console.error("\n" + cliFailure(
          "Model not compatible",
          `${targetModel} is not a GGUF repo and cannot be run by Ollama.`,
          [
            "Only repos that contain pre-quantized .gguf weights work with Ollama.",
            `Try: hf.co/${targetModel.replace(/^hf\.co\//, "")}-GGUF  (if a GGUF fork exists)`,
            "Or search: https://huggingface.co/models?search=gguf",
          ],
        ));
        process.exit(1);
      }
      console.error(`\n  Ollama pull API failed: ${msg}`);
      console.log("  Falling back to Ollama CLI…\n");
      await runOllamaCliFallback(targetModel);
      setSelectedRuntimeModel("local", { id: targetModel, provider: "ollama" });
      setActiveLocalProvider("ollama");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Model Pull Failed", msg));
    process.exit(1);
  }
}

async function runHfLocalPullCommand(repo: string, provider: "llama-cpp" | "mlx", yes = false) {
  // Normalize repo: strip https://huggingface.co/ prefix if present
  const normalizedRepo = repo
    .replace(/^https?:\/\/(www\.)?huggingface\.co\//, "")
    .replace(/^hf\.co\//, "")
    .trim();

  if (!normalizedRepo.includes("/")) {
    console.error(cliFailure(
      "Invalid HF repo",
      `"${repo}" doesn't look like a Hugging Face repo (expected user/repo-name).`,
      ["switchbay model pull apple/OpenELM-3B-Instruct --provider mlx"],
    ));
    process.exit(1);
  }

  const { hfModelLocalPath, registerHfModel } = await import("./src/runtime/hf-model-catalog");
  const localPath = hfModelLocalPath(normalizedRepo);
  const color = cliColorEnabled();

  const providerLabel = provider === "mlx" ? "MLX (Apple Silicon)" : "llama.cpp";
  const includeFilter = provider === "llama-cpp" ? "*.gguf" : undefined;

  // Check huggingface-cli availability
  const hfCliCheck = Bun.spawnSync(["huggingface-cli", "--version"], { stderr: "pipe" });
  if (hfCliCheck.exitCode !== 0) {
    console.error(cliFailure(
      "huggingface-cli not found",
      "The huggingface_hub Python package is required to download HF models.",
      [
        "pip install huggingface_hub[cli]",
        "Then re-run: switchbay model pull " + normalizedRepo + " --provider " + provider,
      ],
    ));
    process.exit(1);
  }

  if (!yes) {
    console.log("\n" + cliPage({
      title: `Download ${normalizedRepo}`,
      state: providerLabel,
      rows: [
        ["Repo",     `huggingface.co/${normalizedRepo}`],
        ["Provider", providerLabel],
        ["Save to",  localPath],
        ...(includeFilter ? [["Filter", includeFilter] as [string, string]] : []),
      ],
      color,
    }));
    const proceed = await confirm("  Download this model?");
    if (!proceed) {
      console.log("  Aborted.");
      process.exit(0);
    }
    console.log("");
  }

  const args = [
    "huggingface-cli", "download", normalizedRepo,
    "--local-dir", localPath,
    ...(includeFilter ? ["--include", includeFilter] : []),
  ];

  console.log(`\n  Downloading from huggingface.co/${normalizedRepo}…\n`);
  const proc = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(cliFailure(
      "Download failed",
      `huggingface-cli exited with code ${exitCode}.`,
      [
        "Check that the repo exists and is public (or set HF_TOKEN for private repos).",
        `huggingface-cli download ${normalizedRepo} --local-dir ${localPath}`,
      ],
    ));
    process.exit(1);
  }

  // Find the primary file (first GGUF for llama-cpp, or note the directory for MLX)
  let primaryFile: string | undefined;
  if (provider === "llama-cpp") {
    const { readdirSync } = await import("node:fs");
    try {
      const files = readdirSync(localPath).filter((f) => f.toLowerCase().endsWith(".gguf")).sort();
      primaryFile = files[0];
    } catch { /* ignore */ }
  }

  const modelId = primaryFile ? `${localPath}/${primaryFile}` : localPath;
  registerHfModel({ repo: normalizedRepo, provider, localPath, ...(primaryFile ? { file: primaryFile } : {}) });
  setSelectedRuntimeModel("local", { id: modelId, provider });
  setActiveLocalProvider(provider);

  const startCmd = provider === "mlx"
    ? `mlx_lm.server --model ${localPath} --port 8080`
    : `llama-server --model ${primaryFile ? `${localPath}/${primaryFile}` : localPath + "/<file>.gguf"} --port 8080`;

  console.log("\n" + cliReceipt(
    providerLabel,
    `Downloaded ${normalizedRepo}`,
    [
      ["Saved to",   localPath],
      ...(primaryFile ? [["Model file", primaryFile] as [string, string]] : []),
      ["Provider",   provider],
      ["Lane",       "local"],
    ],
    startCmd,
  ));
  console.log(`\n  To run: ${startCmd}\n  Then use Switchbay normally — requests will route to your local server.\n`);
}

async function runOllamaCliFallback(model: string) {
  if (!model) throw new Error("Ollama CLI fallback needs a model id.");
  console.log(`  Trying: \`ollama pull ${model}\``);
  try {
    const proc = Bun.spawn(["ollama", "pull", model], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`ollama pull exited with ${exitCode}`);
    }
  } catch (error: any) {
    if (error?.code === "ENOENT" || /ENOENT|not found/i.test(error.message)) {
      throw new Error("Ollama CLI `ollama` was not found. Please make sure Ollama is installed and running.");
    }
    throw error;
  }
}



function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

async function runInspectCommand(imagePath: string | null, question: string | null, task: string | null, lane: string | null) {
  if (!imagePath) {
    console.error(cliFailure("Inspect", "An image path is required.", ["switchbay inspect <path> [--question \"...\"] [--task ui|document|chart|code]"]));
    process.exit(1);
  }

  try {
    const result = await addImageToStore(imagePath);
    const { entry, isNew } = result;
    if (isNew) {
      process.stdout.write(`  ${CLR.muted}└ saved ${entry.id} · ${formatImageSize(entry.size)}${CLR.reset}\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Inspect", msg, []));
    process.exit(1);
  }

  const { prepareOpenAiVisionMessages } = await import("./src/runtime/image-inputs");
  const { hasCloudProviderKey, getCloudProviderConfig } = await import("./src/runtime/cloud-providers");
  const { AnthropicClient } = await import("./src/runtime/anthropic-client");
  const { GeminiClient } = await import("./src/runtime/gemini-client");
  const { OpenAiClient } = await import("./src/runtime/openai-client");

  const taskHint = task ? ` Treat this as a ${task} analysis.` : "";
  const userQuestion = question ?? "Describe what you see in this image. Be specific and thorough.";

  // Build messages with image encoded as content parts
  const rawMessages = [{ role: "user" as const, content: `${userQuestion}${taskHint}\n\n${imagePath}` }];
  const messages = await prepareOpenAiVisionMessages(rawMessages, process.cwd());

  // Pick the first vision-capable provider that has a key configured
  type VisionProvider = "openai" | "google" | "anthropic";
  const visionProviders: VisionProvider[] = lane
    ? ([lane].filter((p): p is VisionProvider => ["openai", "google", "anthropic"].includes(p)))
    : (["openai", "google", "anthropic"] as VisionProvider[]);

  const chosenProvider = visionProviders.find((p) => hasCloudProviderKey(p));
  if (!chosenProvider) {
    console.error(cliFailure("Inspect", "No vision-capable provider configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY.", []));
    process.exit(1);
  }

  const providerLabel = getCloudProviderConfig(chosenProvider).label;
  const providerModel = getCloudProviderConfig(chosenProvider).model;

  process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.muted}${providerLabel} · ${providerModel} (thinking...)${CLR.reset}\n`);

  const visionClient = chosenProvider === "anthropic"
    ? new AnthropicClient()
    : chosenProvider === "google"
      ? new GeminiClient()
      : new OpenAiClient();

  const TIMEOUT_MS = 60_000;
  const timeoutErr = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Vision request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
  );

  let response;
  try {
    response = await Promise.race([
      visionClient.createChatCompletion("inspect", { messages, model: providerModel }),
      timeoutErr,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cliFailure("Inspect", msg, []));
    process.exit(1);
  }

  const content = typeof response.choices?.[0]?.message?.content === "string"
    ? response.choices[0].message.content
    : "";

  process.stdout.write(`\n${content}\n`);
}

async function runExtensionCommand(action: string) {
  const { startExtensionDaemon, stopExtensionDaemon, extensionDaemonStatus, extensionDaemonLogs, EXTENSION_PORT } = await import("./src/extension/server");

  if (action === "stop") {
    const result = await stopExtensionDaemon();
    if (result.stopped) {
      console.log(cliReceipt("Extension", `Server stopped (pid ${result.pid})`, [], "switchbay extension serve"));
    } else {
      process.stdout.write(`${CLR.muted}Extension server is not running.${CLR.reset}\n`);
    }
    return;
  }

  if (action === "status") {
    const { running, info } = await extensionDaemonStatus();
    const state = running ? `Running  pid ${info!.pid}` : "Stopped";
    const rows: [string, string][] = running
      ? [["PID", String(info!.pid)], ["Port", String(EXTENSION_PORT)], ["Started", info!.startedAt], ["Log", info!.logPath]]
      : [["Port", String(EXTENSION_PORT)]];
    console.log(cliPage({ title: "Extension Server", state, summary: "Browser extension backend.", rows, next: running ? "switchbay extension stop" : "switchbay extension serve" }));
    return;
  }

  if (action === "logs") {
    const logs = await extensionDaemonLogs(60);
    process.stdout.write(`\n${logs}\n\n`);
    return;
  }

  // serve (default)
  const { pid, alreadyRunning, logPath } = await startExtensionDaemon();
  if (alreadyRunning) {
    console.log(cliReceipt("Extension", `Already running on port ${EXTENSION_PORT}`, [`pid ${pid}`], "switchbay extension stop"));
  } else {
    console.log(cliReceipt("Extension", `Server started on port ${EXTENSION_PORT}`, [`pid ${pid}`, `log ${logPath}`], "switchbay extension stop"));
  }
}

async function runLiteRtCommand(options: any) {
  const {
    startLiteRtServer, stopLiteRtServer, liteRtStatus, liteRtLogs,
    liteRtServerModels, liteRtLocalList, liteRtImport, liteRtImportLocal, liteRtDelete,
    isLiteRtAvailable, LITERT_PORT, KNOWN_LITERT_MODELS,
  } = await import("./src/runtime/litert-lm");

  const action = options.liteRtAction ?? "status";

  if (!(await isLiteRtAvailable()) && !["status", "logs", "stop"].includes(action)) {
    console.error(cliFailure("LiteRT-LM", "litert-lm is not installed.", [
      "Install: pip install litert-lm",
      "Or: uvx litert-lm (no install needed)",
    ]));
    process.exit(1);
  }

  if (action === "serve") {
    const backend = options.liteRtBackend ?? undefined;
    const { pid, alreadyRunning, logPath } = await startLiteRtServer({ backend });
    if (alreadyRunning) {
      console.log(cliReceipt("LiteRT-LM", `Already running on port ${LITERT_PORT}`, [["pid", String(pid)]], "switchbay litert stop"));
    } else {
      console.log(cliReceipt("LiteRT-LM", `Server started on port ${LITERT_PORT}`, [
        ["pid", String(pid)],
        ["log", logPath],
        ["backend", backend ?? "cpu (default)"],
      ], "switchbay litert stop"));
    }
    return;
  }

  if (action === "stop") {
    const result = await stopLiteRtServer();
    if (result.stopped) {
      console.log(cliReceipt("LiteRT-LM", `Server stopped (pid ${result.pid})`, [], "switchbay litert serve"));
    } else {
      process.stdout.write(`${CLR.muted}LiteRT-LM server is not running.${CLR.reset}\n`);
    }
    return;
  }

  if (action === "logs") {
    const logs = await liteRtLogs(60);
    process.stdout.write(`\n${logs}\n\n`);
    return;
  }

  if (action === "status") {
    const { running, info } = await liteRtStatus();
    const serverModels = running ? await liteRtServerModels() : [];
    const modelList = serverModels.map((m) => m.id).join(", ") || "none loaded";
    const rows: [string, string][] = running
      ? [["PID", String(info!.pid)], ["Port", String(LITERT_PORT)], ["Started", info!.startedAt], ["Models", modelList], ["Log", info!.logPath]]
      : [["Port", String(LITERT_PORT)], ["Install", "pip install litert-lm"]];
    console.log(cliPage({ title: "LiteRT-LM", state: running ? "Running" : "Stopped", summary: "Google on-device inference — LiteRT edge runtime.", rows, next: running ? "switchbay litert stop" : "switchbay litert serve" }));
    return;
  }

  if (action === "models") {
    process.stdout.write(`\n${CLR.bold}LiteRT-LM  Available Models${CLR.reset}\n\n`);
    for (const m of KNOWN_LITERT_MODELS) {
      process.stdout.write(`  ${CLR.accent}${m.id.padEnd(18)}${CLR.reset} ${m.size.padEnd(10)} ${m.description}\n`);
      process.stdout.write(`  ${CLR.muted}${"".padEnd(18)} ${m.hfRepo}${CLR.reset}\n\n`);
    }
    process.stdout.write(`${CLR.muted}Import a model:  switchbay litert import <hf-repo> <filename> <local-id>${CLR.reset}\n\n`);
    return;
  }

  if (action === "list") {
    const { ok, output } = await liteRtLocalList();
    if (!ok || !output) {
      process.stdout.write(`${CLR.muted}No models in local registry. Run: switchbay litert models${CLR.reset}\n`);
      return;
    }
    process.stdout.write(`\n${CLR.bold}LiteRT-LM  Local Registry${CLR.reset}\n\n${output}\n\n`);
    return;
  }

  if (action === "import") {
    const localPath = options.liteRtImportLocalPath;
    const id = options.liteRtImportId;

    if (localPath) {
      if (!id) {
        process.stdout.write(`Usage: switchbay litert import --local <path/to/model.litertlm> <local-id>\n\nExample:\n  switchbay litert import --local ~/Downloads/gemma-4-E2B-it.litertlm gemma4-e2b\n`);
        return;
      }
      process.stdout.write(`${CLR.muted}Registering ${localPath} as "${id}"…${CLR.reset}\n`);
      const { ok, output } = await liteRtImportLocal(localPath, id);
      if (ok) {
        console.log(cliReceipt("LiteRT-LM", `Registered as "${id}"`, [["path", localPath]], "switchbay litert list"));
      } else {
        console.error(cliFailure("LiteRT-LM", "Import failed", [output]));
      }
      return;
    }

    const repo = options.liteRtImportRepo;
    const file = options.liteRtImportFile;
    if (!repo || !file || !id) {
      process.stdout.write(`Usage: switchbay litert import <hf-repo> <filename> <local-id>\n       switchbay litert import --local <path/to/model.litertlm> <local-id>\n\nExample:\n  switchbay litert import litert-community/gemma-4-E2B-it-litert-lm gemma-4-E2B-it.litertlm gemma4-e2b\n  switchbay litert import --local ~/Downloads/gemma-4-E2B-it.litertlm gemma4-e2b\n\nSee available models: switchbay litert models\n`);
      return;
    }
    process.stdout.write(`${CLR.muted}Importing ${file} from ${repo}…${CLR.reset}\n`);
    const { ok, output } = await liteRtImport(repo, file, id);
    if (ok) {
      console.log(cliReceipt("LiteRT-LM", `Imported as "${id}"`, [output.split("\n").pop() ?? ""], "switchbay litert list"));
    } else {
      console.error(cliFailure("LiteRT-LM", "Import failed", [output]));
    }
    return;
  }

  if (action === "delete") {
    const id = options.liteRtDeleteId;
    if (!id) {
      process.stdout.write(`Usage: switchbay litert delete <local-id>\n`);
      return;
    }
    const { ok, output } = await liteRtDelete(id);
    if (ok) {
      console.log(cliReceipt("LiteRT-LM", `Deleted "${id}"`, [], "switchbay litert list"));
    } else {
      console.error(cliFailure("LiteRT-LM", "Delete failed", [output]));
    }
    return;
  }
}

async function runImagesCommand() {
  const entries = await listImages();
  if (!entries.length) {
    process.stdout.write(`${CLR.muted}No images in store. Use: switchbay inspect <path>${CLR.reset}\n`);
    return;
  }
  process.stdout.write(`\n${CLR.bold}Image Store${CLR.reset}  ${CLR.muted}(${entries.length} image${entries.length === 1 ? "" : "s"})${CLR.reset}\n\n`);
  for (const e of entries) {
    const date = new Date(e.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const fmt = e.format ? `.${e.format}` : "";
    process.stdout.write(`  ${CLR.accent}${e.id}${CLR.reset}  ${CLR.muted}${fmt}  ${formatImageSize(e.size)}  ${date}${CLR.reset}\n`);
    process.stdout.write(`         ${e.path}\n`);
    if (e.note) process.stdout.write(`         ${CLR.muted}${e.note}${CLR.reset}\n`);
  }
  process.stdout.write("\n");
}

async function runCliMode(options: any, resumeId: string | null) {
  const { runSwitchbayTurn } = await import("./src/api/service");
  const { modelSpeakerLabel, parseModelAddress } = await import("./src/runtime/model-identity");
  let sessionId = resumeId;
  if (resumeId === "latest") sessionId = (await listSessions())[0]?.id ?? null;
  // Clear JIT session skills from any prior session (new session = clean slate)
  if (!resumeId) await clearSessionSkills().catch(() => {});
  const addressed = parseModelAddress(options.initialQuery);
  process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}${addressed?.speaker ?? "Auto"}${CLR.reset} ${CLR.muted}(thinking...)${CLR.reset}\n`);
  try {
    const deepResearchContext = options.deepResearch ? `DEEP RESEARCH MODE
You have been invoked with --deep-research. Follow this workflow strictly:

1. PLAN — before searching, outline the key questions, angles, and sources needed. Share a brief plan.
2. SEARCH WIDE — use the web-search engine (web_search tool) with multiple distinct queries to gather sources. Aim for at least 5–8 diverse results per angle.
3. READ DEEP — use web_scrape on the most relevant URLs to pull full content, not just snippets.
4. INSTANCE — create a research_instance to store notes and sources durably (research-helpers engine).
5. SYNTHESIZE — after gathering evidence, analyze patterns, contradictions, and gaps before concluding.
6. DELIVER — write a structured markdown report via create_markdown. Separate direct evidence, inferred patterns, and open questions clearly.

Do not skip steps or rush to a conclusion. Cite every claim with its source URL. Flag anything that needs verification.` : undefined;

    const result = await runSwitchbayTurn({
      input: options.visionPath ? `${options.initialQuery}\n\n${options.visionPath}` : options.initialQuery,
      lane: options.lane,
      mode: options.mode,
      profile: options.profile,
      surface: options.surface,
      sessionId: sessionId ?? undefined,
      newSession: options.newSession,
      clientId: sessionId ? undefined : "cli",
      workspace: process.cwd(),
      extraSystemContext: deepResearchContext,
    }, {
      onStep: (title) => process.stdout.write(`  ${CLR.muted}└ ${title}${CLR.reset}\n`),
    });
    const speaker = modelSpeakerLabel(result.route);
    process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}${speaker}${CLR.reset}\n`);
    if (result.route?.using) process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}Using: ${result.route.using}\n`);
    process.stdout.write(`  ${CLR.muted}└ ${CLR.reset}${result.content}\n\n`);
    if (result.pendingApproval) process.stdout.write(`  ${CLR.accentBright}Approval required:${CLR.reset} ${result.pendingApproval.summary}\n  Resume session ${result.sessionId} through the TUI or API to approve it.\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n${CLR.accent}⏺${CLR.reset} ${CLR.text}${CLR.bold}Error:${CLR.reset} ${msg}\n`);
  }
}

function findRuntimeModel(models: RuntimeModelOption[], target: string): RuntimeModelOption | null {
  const normalized = target.trim().toLowerCase();
  return models.find((model) => model.id.toLowerCase() === normalized) ??
    models.find((model) => model.label.toLowerCase() === normalized) ??
    null;
}

function normalizeClientProvider(provider: string | undefined) {
  return provider === "openai" || provider === "anthropic" || provider === "google" ? provider : null;
}

function normalizeClientCloudProvider(provider: ReturnType<typeof normalizeCloudProvider>) {
  return provider === "openai" || provider === "anthropic" || provider === "google" ? provider : null;
}

boot().catch((err) => {
  console.error("switchbay: fatal boot error:", err);
  process.exit(1);
});
