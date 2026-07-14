import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useInput, useStdout } from "ink";
import {
  buildTurn,
  executeTurn,
  extractAssistantText,
  refreshWorkspace,
  synthesizeAssistantFallback,
} from "../agent/loop";
import { compactConversationForContext, parseApprovalIntent, tryLocalCommand } from "../agent/commands";
import { resolveAgentPolicy } from "../agent/policy";
import type { ChatRuntimeClient } from "../runtime/client";
import { createRuntimeClient, getRuntimeLaneLabel } from "../runtime/client";
import { getToolMode, type RuntimeLane, type ToolMode } from "../config/env";
import { clearSelectedRuntimeModel, getOperatorConfig, setSelectedRuntimeModel } from "../config/switchbay-config";
import { createSessionStore, sessionReducer } from "../session/store";
import { createTranscriptEntry } from "../agent/turn-state";
import { loadPersistedSession, savePersistedSession, listSessions, purgeSessions } from "../session/persistence";
import {
  listMentionCandidates,
  parseMentions,
  resolveMentionContent,
  type MentionCandidate,
} from "../tools/mentions";
import { loadAllAgents, type Agent } from "../agent/agents";
import { CommandDrawer } from "./components/CommandDrawer";
import { Composer } from "./components/Composer";
import { EditDrawer } from "./components/EditDrawer";
import { EditIntentDrawer } from "./components/EditIntentDrawer";
import { Header } from "./components/Header";
import { MentionPicker } from "./components/MentionPicker";
import { Transcript } from "./components/Transcript";
import { ResumeDrawer } from "./components/ResumeDrawer";
import { AgentDrawer } from "./components/AgentDrawer";
import { EngineDrawer, flattenEngineDrawerItems } from "./components/EngineDrawer";
import { CreateAgentDrawer, type CreateAgentAnswers } from "./components/CreateAgentDrawer";
import { CreateEngineDrawer, type CreateEngineAnswers } from "./components/CreateEngineDrawer";
import { CreateMcpDrawer, type CreateMcpAnswers } from "./components/CreateMcpDrawer";
import { CreateRuleDrawer, type CreateRuleAnswers } from "./components/CreateRuleDrawer";
import { CreateSkillDrawer, type CreateSkillAnswers } from "./components/CreateSkillDrawer";
import { CreatePluginDrawer, type CreatePluginAnswers } from "./components/CreatePluginDrawer";
import { generateAgentDefinition, generateEngineManifest, generateSwitchbayMcpConfig, generatePlan, generatePluginDefinition, generateRuleDefinition, generateSkillDefinition, type PendingAgentDraft, type PendingEngineDraft, type PendingMcpDraft, type PendingPluginDraft, type PendingRuleDraft, type PendingSkillDraft } from "../agent/loop";
import type { ActivePlan } from "../agent/turn-state";
import { ShortcutDrawer } from "./components/ShortcutDrawer";
import { getCommandMatches } from "./commands";
import { runCommand, runShellString, type ShellResult } from "../tools/shell";
import { loadEngineRegistry, type EngineManifest } from "../engines/registry";
import { ModelDrawer } from "./components/ModelDrawer";
import { listRuntimeModels, type RuntimeModelOption } from "../runtime/models";
import { getActiveLocalProvider, normalizeLocalProvider, setActiveLocalProvider, type LocalProviderId } from "../runtime/local-providers";
import { getActiveCloudProvider, normalizeCloudProvider, setActiveCloudProvider, type CloudProviderMode } from "../runtime/cloud-providers";
import { SkillDrawer } from "./components/SkillDrawer";
import { loadToolboxInventory, type ToolboxSkill } from "../toolbox/hub";
import { RightRail } from "./components/RightRail";
import { saveTraceRecord } from "../trace/store";
import { formatRouteTag } from "../runtime/route-display";
import { modelOptionForAddress, modelSpeakerLabel, parseModelAddress } from "../runtime/model-identity";
import { suggestRuntimeLane } from "../runtime/lane-router";
import { addDailyTask, clearDailyBoard, completeDailyTask, describeDailyBoard, loadDailyBoard, type DailyBoard } from "../operator/daily-board";
import { buildStartupOverview } from "../operator/startup-overview";
import { loadActivePlan, saveActivePlan } from "../planner/store";

export type SwitchbayAppProps = {
  client: ChatRuntimeClient;
  lane?: RuntimeLane;
  initialHopLabel: string | null;
  initialQuery: string;
  mode: string;
  profile: string;
  surface: string;
  resumeId?: string | null;
};

type ComposerMode = "default" | "edit_file_picker" | "edit_intent" | "resume_picker" | "agent_picker" | "engine_picker" | "model_picker" | "skill_picker" | "create_agent" | "create_engine" | "create_mcp" | "create_rule" | "create_skill" | "create_plugin" | "shortcut_picker";

export function SwitchbayApp({
  client,
  lane,
  initialHopLabel,
  initialQuery,
  mode,
  profile,
  surface,
  resumeId = null,
}: SwitchbayAppProps) {
  const initialLane = lane ?? "cloud";
  const [runtimeLane, setRuntimeLane] = useState<RuntimeLane>(initialLane);
  const [localProvider, setLocalProvider] = useState<LocalProviderId>(() => getActiveLocalProvider());
  const [cloudProvider, setCloudProvider] = useState<CloudProviderMode>(() => getActiveCloudProvider());
  const [toolMode, setToolMode] = useState<ToolMode>(() =>
    initialLane === "cloud-mcp" ? "switchbay-mcp" : getToolMode()
  );
  const [runtimeClient, setRuntimeClient] = useState<ChatRuntimeClient>(() => client ?? createRuntimeClient(initialLane, { localProvider, provider: cloudProvider === "auto" ? null : cloudProvider }));
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns ?? 120,
    rows: stdout?.rows ?? 40,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: stdout?.columns ?? 120,
        rows: stdout?.rows ?? 40,
      });
    };
    stdout?.on("resize", handleResize);
    return () => {
      stdout?.off("resize", handleResize);
    };
  }, [stdout]);

  const stdoutWidth = dimensions.columns;
  const stdoutHeight = dimensions.rows;

  const [query, setQuery] = useState("");
  const queryRef = useRef("");
  const setQuerySync = (value: string) => {
    queryRef.current = value;
    setQuery(value);
  };
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [composerMode, setComposerMode] = useState<ComposerMode>("default");
  const [editIntent, setEditIntent] = useState("");
  const [selectedEditFile, setSelectedEditFile] = useState<string | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedEditFileIndex, setSelectedEditFileIndex] = useState(0);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [resumeSessions, setResumeSessions] = useState<{id: string, title: string, updatedAt: number}[]>([]);
  const [selectedResumeIndex, setSelectedResumeIndex] = useState(0);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [availableEngines, setAvailableEngines] = useState<EngineManifest[]>([]);
  const [selectedEngineIndex, setSelectedEngineIndex] = useState(0);
  const [availableModels, setAvailableModels] = useState<RuntimeModelOption[]>([]);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [activeRuntimeModel, setActiveRuntimeModel] = useState<RuntimeModelOption | null>(null);
  const [modelDrawerNotice, setModelDrawerNotice] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<ToolboxSkill[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [skillDrawerNotice, setSkillDrawerNotice] = useState<string | null>(null);
  const [createAgentGenerating, setCreateAgentGenerating] = useState(false);
  const [pendingAgentDraft, setPendingAgentDraft] = useState<PendingAgentDraft | null>(null);
  const [createEngineGenerating, setCreateEngineGenerating] = useState(false);
  const [pendingEngineDraft, setPendingEngineDraft] = useState<PendingEngineDraft | null>(null);
  const [createMcpGenerating, setCreateMcpGenerating] = useState(false);
  const [pendingMcpDraft, setPendingMcpDraft] = useState<PendingMcpDraft | null>(null);
  const [createRuleGenerating, setCreateRuleGenerating] = useState(false);
  const [pendingRuleDraft, setPendingRuleDraft] = useState<PendingRuleDraft | null>(null);
  const [createSkillGenerating, setCreateSkillGenerating] = useState(false);
  const [pendingSkillDraft, setPendingSkillDraft] = useState<PendingSkillDraft | null>(null);
  const [createPluginGenerating, setCreatePluginGenerating] = useState(false);
  const [pendingPluginDraft, setPendingPluginDraft] = useState<PendingPluginDraft | null>(null);
  const [turnThoughts, setTurnThoughts] = useState<string[]>([]);
  const [pendingAgentFollowUp, setPendingAgentFollowUp] = useState<string | null>(null);
  const [pendingLaneSuggestion, setPendingLaneSuggestion] = useState<{ input: string; reason: string } | null>(null);
  const [pendingLaneFollowUp, setPendingLaneFollowUp] = useState<{ input: string; lane: "cloud" | "local" } | null>(null);
  const laneGateBypassRef = useRef(false);
  const [alwaysApprovedShellCommands, setAlwaysApprovedShellCommands] = useState<Set<string>>(() => new Set());
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [dailyBoard, setDailyBoard] = useState<DailyBoard>(() => loadDailyBoard());
  const [pendingUpdateVersion, setPendingUpdateVersion] = useState<string | null>(null);
  const [pendingSkillsUpdate, setPendingSkillsUpdate] = useState(false);
  
  const didHydrateRef = useRef(false);
  const didShowStartupOverviewRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const initialPolicy = resolveAgentPolicy({ mode, profile });
  const [state, dispatch] = useReducer(
    sessionReducer,
    createSessionStore({
      mode: initialPolicy.mode,
      profile,
      resolvedProfile: initialPolicy.runtimeProfile,
      surface,
    })
  );

  const operatorConfig = useMemo(() => getOperatorConfig(), []);
  const commandMatches = useMemo(() => getCommandMatches(query), [query]);
  const refreshDailyBoard = () => setDailyBoard(loadDailyBoard());
  const commandToken = useMemo(() => {
    const match = query.match(/^\/(\S*)$/);
    return match ? match[1] ?? "" : null;
  }, [query]);
  const commandDrawerVisible =
    !initialQuery && composerMode === "default" && commandToken !== null;

  const mentionPartial = useMemo(() => {
    const match = query.match(/@([\w./\-]*)$/);
    return match ? match[1] : null;
  }, [query]);
  const mentionPickerVisible = mentionPartial !== null && composerMode === "default" && !commandDrawerVisible;
  
  const resumeDrawerVisible = composerMode === "resume_picker";
  const shortcutDrawerVisible = composerMode === "shortcut_picker";
  const engineDrawerVisible = composerMode === "engine_picker";
  const modelDrawerVisible = composerMode === "model_picker";
  const skillDrawerVisible = composerMode === "skill_picker";
  const engineDrawerItems = useMemo(() => flattenEngineDrawerItems(availableEngines), [availableEngines]);
  const runtimeBaseLabel = getRuntimeLaneLabel(runtimeLane);
  const runtimeToolSuffix = toolMode === "switchbay-mcp" && runtimeLane !== "cloud-mcp" && runtimeLane !== "local-mcp"
    ? " + MCP Bridge"
    : "";
  const runtimeBadge = activeRuntimeModel
    ? `${runtimeBaseLabel}${runtimeToolSuffix} · ${activeRuntimeModel.id}`
    : `${runtimeBaseLabel}${runtimeToolSuffix}`;

  const editPickerState = useMemo(() => {
    if (composerMode !== "edit_file_picker") {
      return { visible: false, files: [] as string[] };
    }

    const partial = query.trim().toLowerCase();
    const files = (state.workspace?.recentFiles ?? []).filter((file) =>
      partial ? file.toLowerCase().includes(partial) : true,
    );

    return {
      visible: true,
      files: files.slice(0, 8),
    };
  }, [composerMode, query, state.workspace?.recentFiles]);

  const railCanFit = stdoutWidth >= 100;
  const showRightRail = railCanFit && !rightRailCollapsed && !initialQuery;
  const rightRailWidth = showRightRail
    ? Math.max(30, Math.min(44, Math.floor(stdoutWidth * 0.24)))
    : 0;
  const mainWidth = showRightRail ? Math.max(60, stdoutWidth - rightRailWidth) : stdoutWidth;
  const headerRows = state.transcript.length > 0 ? 5 : 0;
  const composerRows = initialQuery ? 3 : state.status === "THINKING" ? Math.min(7, 4 + turnThoughts.length) : 4;
  const drawerRows =
    commandDrawerVisible || mentionPickerVisible || resumeDrawerVisible || shortcutDrawerVisible ||
    editPickerState.visible || composerMode === "agent_picker" || engineDrawerVisible || modelDrawerVisible || skillDrawerVisible || composerMode === "create_agent" || composerMode === "create_engine" || composerMode === "create_mcp" || composerMode === "create_rule" || composerMode === "create_skill" || composerMode === "create_plugin"
      ? 10
      : composerMode === "edit_intent"
        ? 5
        : 0;
  const transcriptAreaHeight = Math.max(5, stdoutHeight - headerRows - composerRows - drawerRows);
  // The live response renders below the persisted feed, but is not itself in
  // state.transcript until the turn completes. Reserve its actual row budget
  // so it cannot paint over the final visible feed entries while streaming.
  const streamingRows = state.streamingText
    ? estimateTranscriptRows(createTranscriptEntry({
        kind: "assistant",
        title: state.activeSpeaker,
        body: state.streamingText,
        tone: "info",
      }), mainWidth)
    : 0;
  const transcriptRowsAvailable = Math.max(1, transcriptAreaHeight - streamingRows);
  const totalTranscriptEntries = state.transcript.length;
  const transcriptScrollPage = Math.max(3, Math.floor(transcriptAreaHeight / 2));
  const maxTranscriptScrollOffset = Math.max(0, totalTranscriptEntries - 1);
  const clampedScrollOffset = Math.min(
    transcriptScrollOffset,
    maxTranscriptScrollOffset,
  );
  const transcriptEndIndex = Math.max(0, totalTranscriptEntries - clampedScrollOffset);
  const { entries: visibleTranscriptEntries, startIndex: transcriptStartIndex } = useMemo(
    () => sliceTranscriptForRows(state.transcript, transcriptEndIndex, transcriptRowsAvailable, mainWidth),
    [state.transcript, transcriptEndIndex, transcriptRowsAvailable, mainWidth],
  );
  function acceptMention(candidate: MentionCandidate) {
    const next = queryRef.current.replace(/@([\w./\-]*)$/, `@${candidate.value}${candidate.isDir ? "/" : ""} `);
    queryRef.current = next;
    setQuery(next);
    setMentionCandidates([]);
    setSelectedMentionIndex(0);
  }

  function switchRuntimeLane(nextLane?: RuntimeLane, nextLocalProvider?: LocalProviderId, nextCloudProvider?: CloudProviderMode) {
    const resolved = nextLane ?? (
      runtimeLane === "cloud"
        ? "local"
        : runtimeLane === "local"
          ? "cloud"
          : runtimeLane === "cloud-mcp"
            ? "local"
            : "cloud"
    );
    const resolvedLocalProvider = nextLocalProvider ?? localProvider;
    const resolvedCloudProvider = nextCloudProvider ?? cloudProvider;
    if (nextLocalProvider) {
      setActiveLocalProvider(nextLocalProvider);
      setLocalProvider(nextLocalProvider);
    }
    if (nextCloudProvider) {
      setActiveCloudProvider(nextCloudProvider);
      setCloudProvider(nextCloudProvider);
    }
    setRuntimeLane(resolved);
    if (resolved === "cloud-mcp") setToolMode("switchbay-mcp");
    if (resolved === "local-mcp") setToolMode("standard");
    setActiveRuntimeModel(null);
    setRuntimeClient(createRuntimeClient(resolved, {
      localProvider: resolvedLocalProvider,
      provider: resolvedCloudProvider === "auto" ? null : resolvedCloudProvider,
    }));
    dispatch({
      type: "assistant/appended",
      message: `Runtime lane switched to **${getRuntimeLaneLabel(resolved)}**${resolved === "cloud" && resolvedCloudProvider !== "auto" ? ` using **${resolvedCloudProvider}**` : ""}.`,
    });
    setQuerySync("");
  }

  function switchToolMode(nextMode?: ToolMode) {
    const resolved = nextMode ?? (toolMode === "switchbay-mcp" ? "standard" : "switchbay-mcp");
    setToolMode(resolved);
    dispatch({
      type: "assistant/appended",
      message: resolved === "switchbay-mcp"
        ? "Switchbay MCP bridge enabled for this session."
        : "Switchbay MCP bridge disabled for this session.",
    });
    setQuerySync("");
  }

  async function openModelDrawer(targetLane: RuntimeLane = runtimeLane, providerOverride: LocalProviderId = localProvider) {
    setComposerMode("model_picker");
    setSelectedModelIndex(0);
    setAvailableModels([]);
    setModelDrawerNotice(targetLane === "local" || targetLane === "local-mcp" ? "Checking local models..." : null);
    try {
      const result = await listRuntimeModels(targetLane, providerOverride);
      setAvailableModels(result.models);
      setModelDrawerNotice(result.notice ?? null);
      const activeIndex = result.models.findIndex((model) =>
        activeRuntimeModel?.id === model.id && activeRuntimeModel.provider === model.provider
      );
      setSelectedModelIndex(activeIndex >= 0 ? activeIndex : 0);
    } catch (error: any) {
      setModelDrawerNotice(`Model list failed: ${error.message}`);
    }
  }

  function selectRuntimeModel(model: RuntimeModelOption) {
    if (model.provider === "auto") {
      clearSelectedRuntimeModel(model.lane);
      setActiveCloudProvider("auto");
      setCloudProvider("auto");
      setRuntimeLane(model.lane);
      setActiveRuntimeModel(null);
      setRuntimeClient(createRuntimeClient(model.lane, { provider: null, localProvider }));
      setComposerMode("default");
      setQuerySync("");
      dispatch({ type: "assistant/appended", message: "Model pin cleared. **Auto** trusted cloud routing is active." });
      return;
    }
    const provider = model.provider === "openai" || model.provider === "anthropic" || model.provider === "google"
      ? model.provider
      : null;
    setRuntimeLane(model.lane);
    if (model.provider === "ollama" || model.provider === "ollama-cloud") {
      const provider = model.provider;
      setActiveLocalProvider(provider);
      setLocalProvider(provider);
    }
    if (model.provider === "openai" || model.provider === "anthropic" || model.provider === "google") {
      setActiveCloudProvider(model.provider);
      setCloudProvider(model.provider);
    }
    if (model.lane === "cloud-mcp") setToolMode("switchbay-mcp");
    if (model.lane === "local-mcp") setToolMode("standard");
    setActiveRuntimeModel(model);
    setSelectedRuntimeModel(model.lane, { id: model.id, provider: model.provider });
    setRuntimeClient(createRuntimeClient(model.lane, { model: model.id, provider, localProvider: model.provider === "ollama" || model.provider === "ollama-cloud" ? model.provider : localProvider }));
    setComposerMode("default");
    setQuerySync("");
    dispatch({
      type: "assistant/appended",
      message: `Model switched to **${model.id}** on **${getRuntimeLaneLabel(model.lane)}**.`,
    });
  }

  async function openSkillDrawer() {
    setComposerMode("skill_picker");
    setSelectedSkillIndex(0);
    setAvailableSkills([]);
    setSkillDrawerNotice("Loading skills...");
    try {
      const inventory = await loadToolboxInventory();
      setAvailableSkills(inventory.skills);
      setSkillDrawerNotice(inventory.exists ? null : "Skills repo is not synced; showing built-in skills.");
    } catch (error: any) {
      setSkillDrawerNotice(`Skill list failed: ${error.message}`);
    }
  }

  function selectSkill(skill: ToolboxSkill) {
    setQuerySync(`Use skill ${skill.id} (${skill.name}) to `);
    setComposerMode("default");
    setSelectedSkillIndex(0);
  }

  useInput((input, key) => {
    if (composerMode === "edit_intent") {
      if (key.escape) {
        setComposerMode("default");
        setSelectedEditFile(null);
        setEditIntent("");
      }
      return;
    }

    if (composerMode === "create_agent" || composerMode === "create_engine" || composerMode === "create_mcp" || composerMode === "create_rule" || composerMode === "create_skill" || composerMode === "create_plugin") {
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
      }
      return;
    }

    if (shortcutDrawerVisible) {
        if (key.escape || key.return) {
            setComposerMode("default");
            setQuerySync("");
        }
        return;
    }

    if (key.ctrl && input.toLowerCase() === "l") {
      switchRuntimeLane();
      return;
    }

    const agentPickerVisible = composerMode === "agent_picker";
    const enginePickerVisible = composerMode === "engine_picker";
    const modelPickerVisible = composerMode === "model_picker";
    const skillPickerVisible = composerMode === "skill_picker";
    if (modelPickerVisible) {
      if (key.upArrow) {
        setSelectedModelIndex((prev) => prev <= 0 ? Math.max(0, availableModels.length - 1) : prev - 1);
        return;
      }
      if (key.downArrow) {
        setSelectedModelIndex((prev) => prev >= availableModels.length - 1 ? 0 : prev + 1);
        return;
      }
      if (key.return || key.tab) {
        const selected = availableModels[selectedModelIndex];
        if (selected) {
          selectRuntimeModel(selected);
        }
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        return;
      }
    }

    if (skillPickerVisible) {
      if (key.upArrow) {
        setSelectedSkillIndex((prev) => prev <= 0 ? Math.max(0, availableSkills.length - 1) : prev - 1);
        return;
      }
      if (key.downArrow) {
        setSelectedSkillIndex((prev) => prev >= availableSkills.length - 1 ? 0 : prev + 1);
        return;
      }
      if (key.return || key.tab) {
        const selected = availableSkills[selectedSkillIndex];
        if (selected) {
          selectSkill(selected);
        }
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        setSelectedSkillIndex(0);
        return;
      }
    }

    if (enginePickerVisible) {
      if (key.upArrow) {
        setSelectedEngineIndex((prev) => prev <= 0 ? Math.max(0, engineDrawerItems.length - 1) : prev - 1);
        return;
      }
      if (key.downArrow) {
        setSelectedEngineIndex((prev) => prev >= engineDrawerItems.length - 1 ? 0 : prev + 1);
        return;
      }
      if (key.return || key.tab) {
        const selected = engineDrawerItems[selectedEngineIndex];
        if (selected?.type === "tool") {
          const required = selected.tool.required?.length
            ? ` with ${selected.tool.required.map((key) => `${key}=...`).join(", ")}`
            : "";
          setQuerySync(`Use engine ${selected.engine.id}.${selected.tool.name}${required}: `);
        } else if (selected?.type === "engine") {
          setQuerySync(`Use the ${selected.engine.name} engine to `);
        }
        setComposerMode("default");
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        return;
      }
    }

    if (agentPickerVisible) {
      if (key.upArrow) {
        setSelectedAgentIndex((prev) => prev <= 0 ? availableAgents.length - 1 : prev - 1);
        return;
      }
      if (key.downArrow) {
        setSelectedAgentIndex((prev) => prev >= availableAgents.length - 1 ? 0 : prev + 1);
        return;
      }
      if (key.return || key.tab) {
        const selected = availableAgents[selectedAgentIndex];
        if (selected) {
          const isActive = state.activeAgentId === selected.id;
          dispatch({ type: "agent/activated", agentId: isActive ? null : selected.id });
          dispatch({
            type: "assistant/appended",
            message: isActive
              ? `${selected.emoji} ${selected.name} deactivated.`
              : `${selected.emoji} **${selected.name}** activated.\n\n${selected.description}`,
          });
        }
        setComposerMode("default");
        setQuerySync("");
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        return;
      }
    }

    if (resumeDrawerVisible) {
      if (key.upArrow) {
        setSelectedResumeIndex((prev) =>
          prev <= 0 ? resumeSessions.length - 1 : prev - 1,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedResumeIndex((prev) =>
          prev >= resumeSessions.length - 1 ? 0 : prev + 1,
        );
        return;
      }
      if (key.return || key.tab) {
        const selected = resumeSessions[selectedResumeIndex];
        if (selected) {
           void handleResumeSession(selected.id);
        }
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        return;
      }
    }

    if (mentionPickerVisible && mentionCandidates.length > 0) {
      if (key.upArrow) {
        setSelectedMentionIndex((prev) =>
          prev <= 0 ? mentionCandidates.length - 1 : prev - 1,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedMentionIndex((prev) =>
          prev >= mentionCandidates.length - 1 ? 0 : prev + 1,
        );
        return;
      }
      if (key.tab || key.return) {
        const selected = mentionCandidates[selectedMentionIndex];
        if (selected) {
          acceptMention(selected);
        }
        return;
      }
      if (key.escape) {
        const next = queryRef.current.replace(/@([\w./\-]*)$/, "").trimEnd();
        queryRef.current = next;
        setQuery(next);
        setMentionCandidates([]);
        setSelectedMentionIndex(0);
        return;
      }
    }

    if (editPickerState.visible) {
      if (key.upArrow) {
        setSelectedEditFileIndex((previous) =>
          editPickerState.files.length === 0
            ? 0
            : (previous - 1 + editPickerState.files.length) % editPickerState.files.length,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedEditFileIndex((previous) =>
          editPickerState.files.length === 0
            ? 0
            : (previous + 1) % editPickerState.files.length,
        );
        return;
      }
      if (key.tab || key.return) {
        const selectedFile = editPickerState.files[selectedEditFileIndex];
        if (selectedFile) {
          setSelectedEditFile(selectedFile);
          setComposerMode("edit_intent");
          setQuerySync("");
          setSelectedEditFileIndex(0);
        }
        return;
      }
      if (key.escape) {
        setQuerySync("");
        setComposerMode("default");
        setSelectedEditFileIndex(0);
        return;
      }
    }

    if (commandDrawerVisible) {
      if (key.upArrow) {
        setSelectedCommandIndex((previous) =>
          commandMatches.length === 0
            ? 0
            : (previous - 1 + commandMatches.length) % commandMatches.length,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedCommandIndex((previous) =>
          commandMatches.length === 0 ? 0 : (previous + 1) % commandMatches.length,
        );
        return;
      }
      if (key.tab) {
        const selectedCommand = commandMatches[selectedCommandIndex];
        if (selectedCommand) {
          setQuerySync(`${selectedCommand.command} `);
          setSelectedCommandIndex(0);
        }
        return;
      }
      if (key.return) {
        const selectedCommand = commandMatches[selectedCommandIndex];
        if (selectedCommand) {
          const cmd = selectedCommand.command;
          setSelectedCommandIndex(0);
          setQuerySync("");
          void handleSubmit(cmd);
        } else {
          void handleSubmit(queryRef.current);
        }
        return;
      }
      if (key.escape) {
        setQuerySync("");
        setSelectedCommandIndex(0);
        setComposerMode("default");
        setTranscriptScrollOffset(0);
        return;
      }
    }

    if (key.ctrl && input === "u") {
      setTranscriptScrollOffset((previous) =>
        Math.min(
          previous + transcriptScrollPage,
          maxTranscriptScrollOffset,
        ),
      );
      return;
    }
    if (key.ctrl && input === "d") {
      setTranscriptScrollOffset((previous) =>
        Math.max(0, previous - transcriptScrollPage),
      );
      return;
    }

    if (!initialQuery) {
      if (key.return) {
        const val = queryRef.current.trim();
        if (val) {
          historyRef.current = [val, ...historyRef.current.filter(h => h !== val)].slice(0, 100);
          historyIndexRef.current = -1;
        }
        void handleSubmit(queryRef.current);
        return;
      }
      if (key.upArrow && queryRef.current === "") {
        const next = historyIndexRef.current + 1;
        if (next < historyRef.current.length) {
          historyIndexRef.current = next;
          setQuerySync(historyRef.current[next] ?? "");
        }
        return;
      }
      if (key.downArrow && historyIndexRef.current >= 0) {
        const next = historyIndexRef.current - 1;
        historyIndexRef.current = next;
        setQuerySync(next >= 0 ? historyRef.current[next] ?? "" : "");
        return;
      }
      if (key.escape) {
        setQuerySync("");
        setSelectedCommandIndex(0);
        setComposerMode("default");
        setTranscriptScrollOffset(0);
        historyIndexRef.current = -1;
        return;
      }
      if (key.backspace || key.delete) {
        const next = queryRef.current.slice(0, -1);
        queryRef.current = next;
        setQuery(next);
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        const next = queryRef.current + input;
        queryRef.current = next;
        if (input === "/" && queryRef.current.length === 1) {
          setSelectedCommandIndex(0);
          setComposerMode("default");
        }
        if (input === "?" && queryRef.current.length === 1) {
            setComposerMode("shortcut_picker");
        }
        setQuery(next);
      }
    }
  });

  useEffect(() => {
    setSelectedCommandIndex((previous) => {
      if (commandMatches.length === 0) {
        return 0;
      }

      return Math.min(previous, commandMatches.length - 1);
    });
  }, [commandMatches.length]);

  useEffect(() => {
    setSelectedEditFileIndex((previous) => {
      if (editPickerState.files.length === 0) {
        return 0;
      }

      return Math.min(previous, editPickerState.files.length - 1);
    });
  }, [editPickerState.files.length]);

  useEffect(() => {
    setSelectedEngineIndex((previous) => {
      if (engineDrawerItems.length === 0) {
        return 0;
      }

      return Math.min(previous, engineDrawerItems.length - 1);
    });
  }, [engineDrawerItems.length]);

  useEffect(() => {
    setTranscriptScrollOffset((previous) =>
      Math.min(previous, maxTranscriptScrollOffset),
    );
  }, [maxTranscriptScrollOffset]);

  useEffect(() => {
    if (resumeId) {
      void loadPersistedSession(resumeId === "latest" ? undefined : resumeId).then((persisted) => {
        if (persisted) {
          dispatch({ type: "session/hydrated", state: persisted });
        }
        didHydrateRef.current = true;
      });
    } else {
      didHydrateRef.current = true;
    }

    void refreshWorkspace().then((workspace) => {
      dispatch({ type: "workspace/updated", workspace });
    });
    
    void loadAllAgents().then((agents) => {
      setAvailableAgents(agents);
    });

    dispatch({ type: "connection/opened" });
  }, []);

  useEffect(() => {
    if (!didHydrateRef.current) {
      return;
    }

    void savePersistedSession(state);
  }, [state]);

  useEffect(() => {
    const cwd = state.workspace?.cwd;
    if (!cwd) return;
    void loadActivePlan(cwd).then((plan) => {
      if (plan && !state.activePlan) dispatch({ type: "plan/created", plan });
    });
  }, [state.workspace?.cwd]);

  useEffect(() => {
    const cwd = state.workspace?.cwd;
    if (!cwd || !state.activePlan) return;
    void saveActivePlan(cwd, state.activePlan).catch(() => {});
  }, [state.workspace?.cwd, state.activePlan]);

  useEffect(() => {
    if (initialQuery || didShowStartupOverviewRef.current || !didHydrateRef.current || !state.workspace) {
      return;
    }

    didShowStartupOverviewRef.current = true;
    if (!operatorConfig.enabled || !operatorConfig.startupOverview) {
      return;
    }

    const workspace = state.workspace;
    let canceled = false;
    void listSessions().then((sessions) => {
      if (canceled) return;
      dispatch({
        type: "assistant/appended",
        message: buildStartupOverview({
          workspace,
          runtimeBadge,
          dailyBoard: operatorConfig.dailyBoard ? dailyBoard : null,
          sessions,
        }),
      });
    });

    return () => {
      canceled = true;
    };
  }, [dailyBoard, initialQuery, operatorConfig, runtimeBadge, state.workspace]);

  useEffect(() => {
    if (initialQuery || !didHydrateRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      import("../runtime/update").then(({ checkForUpdate, checkForToolboxUpdate }) => {
        checkForUpdate().then((latest) => {
          if (latest) {
            import("../../package.json").then((pkg) => {
              dispatch({
                type: "assistant/appended",
                message: `✨ **Update Available**\n\nSwitchbay v${latest} is available! (Current: v${pkg.default.version})\n\nWould you like to update now?\n\n**y** to update and restart · **n** to ignore`,
              });
              setPendingUpdateVersion(latest);
            });
          } else {
            checkForToolboxUpdate(state.workspace?.cwd ?? process.cwd()).then((skillsUpdate) => {
              if (skillsUpdate) {
                dispatch({
                  type: "assistant/appended",
                  message: `✨ **Skills Update Available**\n\nNew toolbox skills are available in the remote repository!\n\nWould you like to sync them now?\n\n**y** to sync skills · **n** to ignore`,
                });
                setPendingSkillsUpdate(true);
              }
            }).catch(() => {});
          }
        }).catch(() => {});
      }).catch(() => {});
    }, 1000);

    return () => clearTimeout(timer);
  }, [initialQuery, didHydrateRef.current, state.workspace]);

  async function performTuiUpdate(latest: string) {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    const isGit = existsSync(join(process.cwd(), ".git"));
    const cmdStr = isGit
      ? `bun index.tsx update`
      : `switchbay update`;

    dispatch({
      type: "assistant/appended",
      message: `Running update in foreground...\nCommand: \`${cmdStr}\``,
    });

    const argsStr = process.argv.slice(2).map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    const relaunchCmd = isGit
      ? `bun index.tsx ${argsStr}`
      : `switchbay ${argsStr}`;

    const fullCmd = `sleep 0.2 && ${cmdStr} && ${relaunchCmd}`;

    const child = Bun.spawn(["sh", "-c", fullCmd], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      detached: true,
    });
    child.unref();
    process.exit(0);
  }

  async function performSkillsUpdate() {
    try {
      const { syncToolboxRepo, loadToolboxInventory } = await import("../toolbox/hub");
      const result = await syncToolboxRepo();
      dispatch({
        type: "assistant/appended",
        message: `✓ **Skills Synced Successfully!**\n\n${result}`,
      });
      const inventory = await loadToolboxInventory(state.workspace?.cwd ?? process.cwd());
      setAvailableSkills(inventory.skills);
    } catch (e: any) {
      dispatch({
        type: "assistant/appended",
        message: `x **Skills Sync Failed:** ${e.message}`,
      });
    }
  }

  async function handleResumeSession(id: string) {
    const persisted = await loadPersistedSession(id);
    if (persisted) {
      dispatch({ type: "session/hydrated", state: persisted });
    }
    setComposerMode("default");
    setQuerySync("");
  }

  async function handleSubmit(value: string) {
    const trimmedVal = value.trim();
    if (!trimmedVal) return;

    // Reset UI state first
    setQuerySync("");
    setComposerMode("default");

    if (pendingLaneSuggestion) {
      const intent = parseApprovalIntent(trimmedVal);
      const original = pendingLaneSuggestion.input;
      if (intent === "apply" || intent === "always") {
        setPendingLaneSuggestion(null);
        switchRuntimeLane("local", localProvider);
        setPendingLaneFollowUp({ input: original, lane: "local" });
        return;
      }
      if (intent === "cancel") {
        setPendingLaneSuggestion(null);
        dispatch({ type: "assistant/appended", message: "Staying on trusted cloud auto-routing." });
        setPendingLaneFollowUp({ input: original, lane: "cloud" });
        return;
      }
      dispatch({ type: "assistant/appended", message: "Choose **y** to switch local or **n** to stay on cloud." });
      return;
    }

    // HANDLE SLASH COMMANDS
    if (trimmedVal === "/sessions") {
      const sessions = await listSessions();
      const recent = sessions.slice(0, 10);
      if (recent.length === 0) {
        dispatch({
          type: "assistant/appended",
          message: "No recent local sessions found.",
        });
      } else {
        let list = "Recent local sessions:\n";
        recent.forEach((s, i) => {
          const date = new Date(s.updatedAt).toLocaleString();
          list += `${i}. ${s.title} (${date})\n`;
        });
        list += "\nUse /resume to pick one, or switchbay --resume <index>";
        dispatch({
          type: "assistant/appended",
          message: list,
        });
      }
      return;
    }

    if (trimmedVal.startsWith("/purge")) {
      const parts = trimmedVal.split(" ");
      const duration = parts[1]?.toLowerCase() || "1d";
      let ms = 0;
      const match = duration.match(/^(\d+)([dw])$/);
      if (match) {
        const count = parseInt(match[1] ?? "0", 10);
        const unit = match[2] ?? "";
        if (unit === "d") ms = count * 24 * 60 * 60 * 1000;
        else if (unit === "w") ms = count * 7 * 24 * 60 * 60 * 1000;
        
        const countPurged = await purgeSessions(ms);
        dispatch({
          type: "assistant/appended",
          message: `I’ve purged ${countPurged} session(s) older than ${duration}.`,
        });
      } else {
        dispatch({
          type: "assistant/appended",
          message: `Invalid purge duration "${duration}". Use e.g. 1d, 5d, 2w.`,
        });
      }
      return;
    }

    if (trimmedVal === "/save") {
      await savePersistedSession(state);
      dispatch({
        type: "assistant/appended",
        message: "I’ve saved the current session state.",
      });
      return;
    }

    if (trimmedVal === "/resume") {
      const sessions = await listSessions();
      setResumeSessions(sessions);
      setSelectedResumeIndex(0);
      setComposerMode("resume_picker");
      return;
    }

    if (trimmedVal === "/new") {
      const workspace = await refreshWorkspace();
      const policy = resolveAgentPolicy({ mode, profile });

      dispatch({
        type: "session/reset",
        state: createSessionStore({
          mode: policy.mode,
          profile,
          resolvedProfile: policy.runtimeProfile,
          surface,
        }),
      });

      dispatch({ type: "workspace/updated", workspace });
      setTranscriptScrollOffset(0);
      setSelectedEditFile(null);
      setEditIntent("");
      return;
    }

    if (trimmedVal === "/lane" || trimmedVal.startsWith("/lane ")) {
      const requested = trimmedVal.slice("/lane".length).trim().toLowerCase();
      if (!requested) {
        switchRuntimeLane();
        return;
      }
      if (requested === "cloud") {
        switchRuntimeLane("cloud", undefined, "auto");
        return;
      }
      if (requested === "openrouter" || requested === "open-router" || requested === "or") {
        switchRuntimeLane("openrouter");
        return;
      }
      if (requested === "huggingface" || requested === "hugging-face" || requested === "hf" || requested === "hf-cloud") {
        switchRuntimeLane("huggingface");
        return;
      }
      const requestedCloudProvider = normalizeCloudProvider(requested);
      if (requestedCloudProvider && requestedCloudProvider !== "auto") {
        switchRuntimeLane("cloud", undefined, requestedCloudProvider);
        return;
      }
      if (requested === "cloud-mcp" || requested === "cloudmcp" || requested === "cmcp") {
        setToolMode("switchbay-mcp");
        switchRuntimeLane("cloud");
        return;
      }
      if (requested === "local") {
        switchRuntimeLane("local");
        return;
      }
      if (requested === "ollama") {
        switchRuntimeLane("local", "ollama");
        return;
      }
      if (requested === "ollama-cloud" || requested === "ollama_cloud" || requested === "oc") {
        switchRuntimeLane("local", "ollama-cloud");
        return;
      }
      if (requested === "mcp" || requested === "switchbay-mcp" || requested === "bridge") {
        switchToolMode("switchbay-mcp");
        return;
      }
      dispatch({
        type: "assistant/appended",
        message: `Unknown lane \`${requested}\`. Use \`/lane cloud\`, \`/lane openai\`, \`/lane anthropic\`, \`/lane gemini\`, \`/lane huggingface\`, \`/lane openrouter\`, \`/lane local\`, \`/lane ollama\`, \`/lane ollama-cloud\`, \`/lane mcp\`, or \`/lane\` to toggle.`,
      });
      setQuerySync("");
      return;
    }

    if (trimmedVal === "/collapse") {
      setRightRailCollapsed((value) => !value);
      setTranscriptScrollOffset(0);
      setQuerySync("");
      return;
    }

    if (trimmedVal === "/auto") {
      clearSelectedRuntimeModel("cloud");
      clearSelectedRuntimeModel("cloud-mcp");
      setActiveCloudProvider("auto");
      setCloudProvider("auto");
      setRuntimeLane("cloud");
      setActiveRuntimeModel(null);
      setRuntimeClient(createRuntimeClient("cloud", { provider: null, localProvider }));
      dispatch({ type: "assistant/appended", message: "Model pin cleared. **Auto** trusted cloud routing is active." });
      setQuerySync("");
      return;
    }

    if (trimmedVal === "/model" || trimmedVal === "/models" || trimmedVal.startsWith("/model ") || trimmedVal.startsWith("/models ")) {
      const commandName = trimmedVal.startsWith("/models") ? "/models" : "/model";
      const requested = trimmedVal.slice(commandName.length).trim().toLowerCase();
      if (!requested) {
        void openModelDrawer(runtimeLane);
        setQuerySync("");
        return;
      }
      if (requested === "cloud") {
        void openModelDrawer("cloud");
        setQuerySync("");
        return;
      }
      if (requested === "openrouter" || requested === "open-router" || requested === "or") {
        void openModelDrawer("openrouter");
        return;
      }
      if (requested === "huggingface" || requested === "hugging-face" || requested === "hf" || requested === "hf-cloud") {
        void openModelDrawer("huggingface");
        return;
      }
      if (normalizeCloudProvider(requested)) {
        void openModelDrawer("cloud");
        setQuerySync("");
        return;
      }
      if (requested === "cloud-mcp" || requested === "cloudmcp" || requested === "cmcp") {
        setToolMode("switchbay-mcp");
        void openModelDrawer("cloud");
        setQuerySync("");
        return;
      }
      if (requested === "local") {
        void openModelDrawer("local", localProvider);
        setQuerySync("");
        return;
      }
      if (requested === "ollama") {
        setActiveLocalProvider("ollama");
        setLocalProvider("ollama");
        void openModelDrawer("local", "ollama");
        setQuerySync("");
        return;
      }
      if (requested === "ollama-cloud" || requested === "ollama_cloud" || requested === "oc") {
        setActiveLocalProvider("ollama-cloud");
        setLocalProvider("ollama-cloud");
        void openModelDrawer("local", "ollama-cloud");
        return;
      }
      if (requested === "mcp" || requested === "switchbay-mcp" || requested === "bridge") {
        setToolMode("switchbay-mcp");
        void openModelDrawer(runtimeLane);
        setQuerySync("");
        return;
      }
      dispatch({
        type: "assistant/appended",
        message: `Unknown model lane \`${requested}\`. Use \`/model\`, \`/model cloud\`, \`/model cloud-mcp\`, \`/model local\`, \`/model ollama\`, or \`/model mcp\`.`,
      });
      setQuerySync("");
      return;
    }

    if (trimmedVal === "/mcp on" || trimmedVal === "/mcp bridge" || trimmedVal === "/mcp switchbay") {
      switchToolMode("switchbay-mcp");
      return;
    }

    if (trimmedVal === "/mcp off" || trimmedVal === "/mcp standard") {
      switchToolMode("standard");
      return;
    }

    // ── Plan flow — approval, continue, skip, stop ────────────────────────
    if (state.activePlan) {
      const { activePlan } = state;

      if (activePlan.status === "pending_approval") {
        const intent = parseApprovalIntent(trimmedVal);
        if (intent === "apply" || intent === "always") {
          const firstStep = activePlan.steps[0];
          if (!firstStep) return;
          dispatch({ type: "plan/started" });
          setQuerySync("");
          // Execute step 0 immediately
          void handleSubmit(firstStep);
          return;
        }
        if (intent === "cancel") {
          dispatch({ type: "plan/stopped" });
          dispatch({ type: "assistant/appended", message: "Plan cancelled." });
          setQuerySync("");
          return;
        }
      }

      if (activePlan.status === "awaiting_continue") {
        if (trimmedVal === "stop" || trimmedVal === "/stop") {
          dispatch({ type: "plan/stopped" });
          dispatch({ type: "assistant/appended", message: `Plan stopped at step ${activePlan.currentStep + 1}/${activePlan.steps.length}.` });
          setQuerySync("");
          return;
        }
        if (trimmedVal === "skip") {
          dispatch({ type: "plan/step-skipped" });
          setQuerySync("");
          const next = activePlan.currentStep + 1;
          if (next < activePlan.steps.length) {
            const nextStep = activePlan.steps[next];
            if (!nextStep) return;
            dispatch({ type: "plan/started" });
            void handleSubmit(nextStep);
          }
          return;
        }
        const intent = parseApprovalIntent(trimmedVal);
        if (intent === "apply" || intent === "always") {
          const currentStep = activePlan.steps[activePlan.currentStep];
          if (!currentStep) return;
          dispatch({ type: "plan/started" });
          setQuerySync("");
          void handleSubmit(currentStep);
          return;
        }
      }
    }

    // Pending update confirmation
    if (pendingUpdateVersion) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        const version = pendingUpdateVersion;
        setPendingUpdateVersion(null);
        setQuerySync("");
        void performTuiUpdate(version);
        return;
      }
      if (intent === "cancel") {
        setPendingUpdateVersion(null);
        dispatch({ type: "assistant/appended", message: "Update ignored." });
        setQuerySync("");
        return;
      }
    }

    // Pending skills update confirmation
    if (pendingSkillsUpdate) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        setPendingSkillsUpdate(false);
        setQuerySync("");
        void performSkillsUpdate();
        return;
      }
      if (intent === "cancel") {
        setPendingSkillsUpdate(false);
        dispatch({ type: "assistant/appended", message: "Skills update ignored." });
        setQuerySync("");
        return;
      }
    }

    // Pending agent draft approval — y to save, n to discard
    if (pendingAgentDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingAgentDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingAgentDraft.savePath, pendingAgentDraft.content, "utf-8");
          const agents = await loadAllAgents();
          setAvailableAgents(agents);
          dispatch({
            type: "assistant/appended",
            message: `✓ Agent **${pendingAgentDraft.name}** saved to \`${pendingAgentDraft.savePath}\`\n\nActivate it with \`/agent ${pendingAgentDraft.id}\` or via \`/agents\`.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingAgentDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingAgentDraft(null);
        dispatch({ type: "assistant/appended", message: "Agent discarded." });
        setQuerySync("");
        return;
      }
    }

    if (pendingEngineDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingEngineDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingEngineDraft.savePath, pendingEngineDraft.content, "utf-8");
          const registry = await loadEngineRegistry(state.workspace?.cwd ?? process.cwd());
          setAvailableEngines(registry.engines);
          dispatch({
            type: "assistant/appended",
            message: `✓ Engine **${pendingEngineDraft.name}** saved to \`${pendingEngineDraft.savePath}\`\n\nOpen it with \`/engines\` or ask a model to use \`${pendingEngineDraft.id}\`.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingEngineDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingEngineDraft(null);
        dispatch({ type: "assistant/appended", message: "Engine discarded." });
        setQuerySync("");
        return;
      }
    }

    if (pendingMcpDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingMcpDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingMcpDraft.savePath, pendingMcpDraft.content, "utf-8");
          dispatch({
            type: "assistant/appended",
            message: `✓ MCP config **${pendingMcpDraft.name}** saved to \`${pendingMcpDraft.savePath}\`\n\nEnable external MCP tools with \`/mcp on\`.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingMcpDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingMcpDraft(null);
        dispatch({ type: "assistant/appended", message: "MCP config discarded." });
        setQuerySync("");
        return;
      }
    }

    if (pendingRuleDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingRuleDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingRuleDraft.savePath, pendingRuleDraft.content, "utf-8");
          dispatch({
            type: "assistant/appended",
            message: `✓ Rule **${pendingRuleDraft.name}** saved to \`${pendingRuleDraft.savePath}\`\n\nBay will load it in future turns through Quick Starts and Rules.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingRuleDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingRuleDraft(null);
        dispatch({ type: "assistant/appended", message: "Rule discarded." });
        setQuerySync("");
        return;
      }
    }

    if (pendingSkillDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingSkillDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingSkillDraft.savePath, pendingSkillDraft.content, "utf-8");
          const inventory = await loadToolboxInventory(state.workspace?.cwd ?? process.cwd());
          setAvailableSkills(inventory.skills);
          dispatch({
            type: "assistant/appended",
            message: `✓ Skill **${pendingSkillDraft.name}** saved to \`${pendingSkillDraft.savePath}\`\n\nOpen it with \`/skills\` or ask a model to use \`${pendingSkillDraft.id}\`.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingSkillDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingSkillDraft(null);
        dispatch({ type: "assistant/appended", message: "Skill discarded." });
        setQuerySync("");
        return;
      }
    }

    if (pendingPluginDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        try {
          const dir = pendingPluginDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingPluginDraft.savePath, pendingPluginDraft.content, "utf-8");
          const [agents, engines, inventory] = await Promise.all([
            loadAllAgents(),
            loadEngineRegistry(state.workspace?.cwd ?? process.cwd()),
            loadToolboxInventory(state.workspace?.cwd ?? process.cwd()),
          ]);
          setAvailableAgents(agents);
          setAvailableEngines(engines.engines);
          setAvailableSkills(inventory.skills);
          dispatch({
            type: "assistant/appended",
            message: `✓ Plugin **${pendingPluginDraft.name}** saved to \`${pendingPluginDraft.savePath}\`\n\nInspect it with \`/plugins inspect ${pendingPluginDraft.id}\`. Add real assets under the plugin folder when you're ready.`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Save failed: ${e.message}` });
        }
        setPendingPluginDraft(null);
        setQuerySync("");
        return;
      }
      if (intent === "cancel") {
        setPendingPluginDraft(null);
        dispatch({ type: "assistant/appended", message: "Plugin discarded." });
        setQuerySync("");
        return;
      }
    }

    // Shell command approval — handled before tryLocalCommand so we can exec async
    if (state.pendingShell && state.pendingApproval?.kind === "shell_command") {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply" || intent === "always") {
        const shellCmd = state.pendingShell;
        const shellCwd = state.workspace?.cwd ?? process.cwd();
        if (intent === "always") {
          setAlwaysApprovedShellCommands((previous) => new Set(previous).add(shellCmd.command));
        }
        setQuerySync("");
        dispatch({ type: "approval/approved", requestId: state.pendingApproval.id });
        dispatch({ type: "shell/cleared" });
        dispatch({
          type: "turn/submitted",
          message: { role: "user", content: intent === "always" ? "Approved shell command permanently." : "Approved shell command." },
          objective: "Run approved shell command",
          pendingPlan: [],
          mode: state.mode,
          resolvedProfile: state.resolvedProfile,
        });
        dispatch({ type: "turn/started" });
        try {
          const result = await runShellString(shellCmd.command, shellCwd);
          if (!result.ok) {
            throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
          }
          dispatch({ type: "turn/completed", content: formatShellCompletion(result) });
        } catch (err: any) {
          dispatch({ type: "turn/failed", error: `Shell failed: ${err.message}` });
        }
        return;
      }
      if (intent === "cancel") {
        setQuerySync("");
        dispatch({ type: "approval/rejected", requestId: state.pendingApproval.id });
        dispatch({ type: "shell/cleared" });
        dispatch({ type: "assistant/appended", message: "Canceled." });
        return;
      }
    }

    if (trimmedVal === "/clear") {
      const workspace = await refreshWorkspace();
      const policy = resolveAgentPolicy({ mode, profile });

      dispatch({
        type: "session/reset",
        state: createSessionStore({
          mode: policy.mode,
          profile,
          resolvedProfile: policy.runtimeProfile,
          surface,
        }),
      });

      dispatch({ type: "workspace/updated", workspace });
      setTranscriptScrollOffset(0);
      setSelectedEditFile(null);
      setEditIntent("");
      return;
    }

    if (trimmedVal === "/agenda" || trimmedVal === "/today" || trimmedVal === "/tasks") {
      dispatch({ type: "assistant/appended", message: describeDailyBoard() });
      setQuerySync("");
      return;
    }

    if (trimmedVal === "/task" || trimmedVal.startsWith("/task ")) {
      const rest = trimmedVal.slice("/task".length).trim();
      const [action, ...args] = rest.split(/\s+/).filter(Boolean);
      try {
        if (!action || action === "status" || action === "list") {
          dispatch({ type: "assistant/appended", message: describeDailyBoard() });
          setQuerySync("");
          return;
        }

        if (action === "add" || action === "remember" || action === "remind") {
          const text = args.join(" ").trim();
          if (!text) {
            dispatch({ type: "assistant/appended", message: "Give me the task text, like `/task add test brew install`." });
            setQuerySync("");
            return;
          }
          const task = addDailyTask(text);
          refreshDailyBoard();
          dispatch({
            type: "assistant/appended",
            message: `Added Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`,
          });
          setQuerySync("");
          return;
        }

        if (action === "done" || action === "complete" || action === "finish") {
          const id = Number.parseInt(args[0] ?? "", 10);
          if (!Number.isInteger(id) || id <= 0) {
            dispatch({ type: "assistant/appended", message: "Tell me which task to mark done, like `/task done 1`." });
            setQuerySync("");
            return;
          }
          const task = completeDailyTask(id);
          if (!task) {
            dispatch({ type: "assistant/appended", message: `I don't see task **${id}** on today's board.` });
            setQuerySync("");
            return;
          }
          refreshDailyBoard();
          dispatch({
            type: "assistant/appended",
            message: `Completed Daily Board task **${task.id}**: ${task.text}\n\n${describeDailyBoard()}`,
          });
          setQuerySync("");
          return;
        }

        if (action === "clear" || action === "reset") {
          const count = clearDailyBoard();
          refreshDailyBoard();
          dispatch({
            type: "assistant/appended",
            message: `Cleared ${count} Daily Board task${count === 1 ? "" : "s"}.`,
          });
          setQuerySync("");
          return;
        }

        dispatch({
          type: "assistant/appended",
          message: `Unknown task action \`${action}\`. Use \`/task add <text>\`, \`/task done <id>\`, or \`/task clear\`.`,
        });
        setQuerySync("");
        return;
      } catch (error: any) {
        dispatch({ type: "assistant/appended", message: `Daily Board: ${error.message}` });
        setQuerySync("");
        return;
      }
    }

    const workspace = state.workspace ?? (await refreshWorkspace());
    if (!state.workspace) {
      dispatch({ type: "workspace/updated", workspace });
    }

    const onStep = (title: string) => {
      setTurnThoughts((previous) => appendTurnThought(previous, title));
      dispatch({ type: "workstep/add", message: title });
    };
    const onTokens = (count: number) => {
        dispatch({ type: "turn/tokens", count });
    };
    let didStream = false;
    const onToken = (token: string) => {
      didStream = true;
      dispatch({ type: "turn/token", token });
    };
    const onStreamReset = (draft: string) => {
      didStream = false;
      dispatch({ type: "turn/response", content: "" });
      if (draft.trim()) {
        setTurnThoughts((previous) => appendTurnThought(previous, draft));
        dispatch({ type: "progress-message/add", message: draft });
      }
    };
    setTurnThoughts([]);

    const localCommand = await tryLocalCommand(trimmedVal, {
      client: runtimeClient,
      profile: state.resolvedProfile,
      sessionId: state.sessionId,
      surface,
      workspace,
      conversation: state.conversation,
      lastChangedFile: state.changedFiles[state.changedFiles.length - 1] ?? null,
      activeAgentId: state.activeAgentId,
      runtimeLane,
      toolMode,
    });
    if (localCommand.handled) {
      dispatch({ type: "local-command/submitted", input: value });

      if (localCommand.dailyBoardChanged) {
        refreshDailyBoard();
      }

      if (localCommand.workspace) {
        dispatch({ type: "workspace/updated", workspace: localCommand.workspace });
      }

      if (localCommand.patch && localCommand.changedFile) {
        dispatch({
          type: "patch/updated",
          patch: localCommand.patch,
          changedFile: localCommand.changedFile,
        });
      }

      if (localCommand.travel) {
        dispatch({
          type: "travel/completed",
          toPath: localCommand.travel.toPath,
          label: localCommand.travel.label,
          workspace: localCommand.travel.workspace,
        });
        void loadAllAgents().then((agents) => {
          setAvailableAgents(agents);
        });
      }

      // ── /plan ────────────────────────────────────────────────────────────
      if (localCommand.planGoal) {
        const goal = localCommand.planGoal;
        const cwd = state.workspace?.cwd ?? process.cwd();
        dispatch({ type: "assistant/appended", message: `Planning: _${goal}_…` });
        try {
          const steps = await generatePlan(runtimeClient, surface, goal, cwd);
          const plan: ActivePlan = {
            id: `plan-${Date.now()}`,
            goal,
            steps,
            currentStep: 0,
            completedSteps: [],
            status: "pending_approval",
          };
          dispatch({ type: "plan/created", plan });
          const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
          dispatch({
            type: "assistant/appended",
            message: `**Plan: ${goal}**\n\n${stepList}\n\n**y** to execute · **n** to cancel`,
          });
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Failed to generate plan: ${e.message}` });
        }
        return;
      }

      // ── /checkpoint ──────────────────────────────────────────────────────
      if (localCommand.checkpointOp) {
        const cwd = state.workspace?.cwd ?? process.cwd();
        const { op } = localCommand.checkpointOp;
        try {
          const runGit = async (args: string[]) => {
            const result = await runCommand(args, cwd);
            if (!result.ok) {
              throw new Error(result.stderr || result.stdout || `${args.join(" ")} failed`);
            }
            return result.stdout;
          };

          if (op === "create") {
            const { name } = localCommand.checkpointOp as { op: "create"; name: string };
            await runGit(["git", "stash", "push", "--include-untracked", "-m", `switchbay: ${name}`]);
            dispatch({ type: "assistant/appended", message: `Checkpoint saved: **${name}**\n\nRestore with \`/restore\` or \`/checkpoints\` to list all.` });
          }

          if (op === "list") {
            const out = await runGit(["git", "stash", "list"]);
            const checkpoints = out
              .split("\n")
              .filter(isSwitchbayCheckpointLine)
              .map((l, i) => {
                const match = l.match(/switchbay:\s*(.+)$/);
                return `${i}. ${match?.[1] ?? l}`;
              });
            dispatch({
              type: "assistant/appended",
              message: checkpoints.length
                ? `**Checkpoints:**\n\n${checkpoints.join("\n")}\n\nUse \`/restore <n>\` to restore one.`
                : "No checkpoints found. Create one with `/checkpoint <name>`.",
            });
          }

          if (op === "restore") {
            const { index } = localCommand.checkpointOp as { op: "restore"; index: number };
            const out = await runGit(["git", "stash", "list"]);
            const switchbayStashes = out.split("\n").filter(isSwitchbayCheckpointLine);
            if (index >= switchbayStashes.length) {
              dispatch({ type: "assistant/appended", message: `No checkpoint at index ${index}. Run \`/checkpoints\` to list.` });
            } else {
              const stashLine = switchbayStashes[index] ?? "";
              const stashRef = stashLine.match(/^(stash@\{\d+\})/)?.[1];
              if (stashRef) {
                await runGit(["git", "stash", "apply", stashRef]);
                const nameMatch = stashLine.match(/switchbay:\s*(.+)$/);
                dispatch({ type: "assistant/appended", message: `Restored checkpoint: **${nameMatch?.[1] ?? stashRef}**` });
              }
            }
          }
        } catch (e: any) {
          dispatch({ type: "assistant/appended", message: `Checkpoint failed: ${e.message}` });
        }
        return;
      }

      if (localCommand.openCreateAgent) {
        setComposerMode("create_agent");
        setQuerySync("");
        return;
      }

      if (localCommand.openCreateEngine) {
        setComposerMode("create_engine");
        setQuerySync("");
        return;
      }

      if (localCommand.openCreateMcp) {
        setComposerMode("create_mcp");
        setQuerySync("");
        return;
      }

      if (localCommand.openCreateRule) {
        setComposerMode("create_rule");
        setQuerySync("");
        return;
      }

      if (localCommand.openCreateSkill) {
        setComposerMode("create_skill");
        setQuerySync("");
        return;
      }

      if (localCommand.openCreatePlugin) {
        setComposerMode("create_plugin");
        setQuerySync("");
        return;
      }

      if (localCommand.openAgentPicker) {
        const agents = await loadAllAgents();
        setAvailableAgents(agents);
        setSelectedAgentIndex(0);
        setComposerMode("agent_picker");
        setQuerySync("");
        return;
      }

      if (localCommand.openEnginePicker) {
        const registry = await loadEngineRegistry(state.workspace?.cwd ?? process.cwd());
        setAvailableEngines(registry.engines);
        setSelectedEngineIndex(0);
        setComposerMode("engine_picker");
        setQuerySync("");
        return;
      }

      if (localCommand.openSkillPicker) {
        await openSkillDrawer();
        setQuerySync("");
        return;
      }

      if ("activateAgent" in localCommand) {
        dispatch({ type: "agent/activated", agentId: localCommand.activateAgent ?? null });
        dispatch({
          type: "assistant/appended",
          message: localCommand.assistantMessage ?? (localCommand.activateAgent ? "Agent activated." : "Agent deactivated."),
        });
        if (localCommand.activateAgent && localCommand.followUpInput) {
          setPendingAgentFollowUp(localCommand.followUpInput);
        }
        return;
      }

      if (localCommand.compactedConversation) {
        dispatch({ type: "conversation/replaced", messages: localCommand.compactedConversation });
        dispatch({ type: "assistant/appended", message: localCommand.assistantMessage ?? "Context compacted. Work feed retained." });
        return;
      }

      dispatch({
        type: "assistant/appended",
        message:
          localCommand.assistantMessage ??
          "Local command ran, but it did not produce a message.",
      });

      if (localCommand.followUpInput) {
        await handleSubmit(localCommand.followUpInput);
      }
      return;
    }

    const bypassLaneGate = laneGateBypassRef.current;
    laneGateBypassRef.current = false;
    const laneSuggestion = !bypassLaneGate && runtimeLane === "cloud" && cloudProvider === "auto" && !activeRuntimeModel
      ? suggestRuntimeLane(trimmedVal)
      : null;
    if (laneSuggestion) {
      const localModels = await listRuntimeModels("local", localProvider).catch(() => ({ models: [] }));
      if (localModels.models.length > 0) {
        setPendingLaneSuggestion({ input: value, reason: laneSuggestion.reason });
        dispatch({
          type: "assistant/appended",
          message: `${laneSuggestion.reason}\n\nThis task looks suitable for **${getRuntimeLaneLabel("local")}**. Switch before continuing?\n\n**y** switch local · **n** stay cloud`,
        });
        return;
      }
    }

    const { mentions, cleanQuery } = parseMentions(value);
    const modelAddress = parseModelAddress(value);
    const addressedModel = modelAddress ? modelOptionForAddress(modelAddress) : null;
    const turnClient = modelAddress
      ? createRuntimeClient(modelAddress.lane, {
          model: addressedModel?.provider === "auto" ? undefined : addressedModel?.id,
          provider: modelAddress.provider,
          localProvider: modelAddress.localProvider ?? localProvider,
        })
      : runtimeClient;
    if (modelAddress?.auto) {
      clearSelectedRuntimeModel("cloud");
      clearSelectedRuntimeModel("cloud-mcp");
      setActiveCloudProvider("auto");
      setCloudProvider("auto");
      setRuntimeLane("cloud");
      setActiveRuntimeModel(null);
      setRuntimeClient(turnClient);
    } else if (modelAddress && addressedModel) {
      setSelectedRuntimeModel(addressedModel.lane, { id: addressedModel.id, provider: addressedModel.provider });
      setRuntimeLane(addressedModel.lane);
      setActiveRuntimeModel(addressedModel);
      if (modelAddress.provider) {
        setActiveCloudProvider(modelAddress.provider);
        setCloudProvider(modelAddress.provider);
      }
      if (modelAddress.localProvider) {
        setActiveLocalProvider(modelAddress.localProvider);
        setLocalProvider(modelAddress.localProvider);
      }
      setRuntimeClient(turnClient);
    }
    dispatch({ type: "turn/speaker", speaker: modelAddress?.speaker ?? "Model" });
    let mentionContext = "";
    if (mentions.length > 0) {
      const cwd = workspace?.cwd ?? process.cwd();
      const resolved = await Promise.allSettled(
        mentions.map((m) => resolveMentionContent(m, cwd)),
      );
      const parts = resolved
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      if (parts.length > 0) {
        mentionContext = parts.join("\n\n") + "\n\n";
      }
    }
    const effectiveInput = mentionContext ? `${mentionContext}${cleanQuery || value}` : value;
    let conversationForTurn = state.conversation;
    const automaticCompaction = await compactConversationForContext({
      client: turnClient,
      conversation: state.conversation,
      surface,
    }).catch(() => null);
    if (automaticCompaction) {
      conversationForTurn = automaticCompaction.messages;
      dispatch({ type: "conversation/replaced", messages: automaticCompaction.messages });
      dispatch({
        type: "assistant/appended",
        message: "Context refreshed for this session — the full work feed remains above.",
      });
    }

      const turn = await buildTurn({
      input: effectiveInput,
      mode,
      profile,
      previousObjective: state.currentObjective,
      transcript: conversationForTurn,
      workspace,
      activeAgentId: state.activeAgentId,
      runtimeLane,
      toolMode,
    });

    dispatch({
      type: "turn/submitted",
      message: { role: "user", content: value },
      objective: turn.objective,
      pendingPlan: turn.pendingPlan,
      mode: turn.mode,
      resolvedProfile: turn.resolvedProfile,
    });

    dispatch({ type: "turn/started" });

    try {
      const executedTurn = await executeTurn({
        client: turnClient,
        cwd: workspace?.cwd ?? process.cwd(),
        sessionId: state.sessionId,
        surface,
        turn,
        workspace,
        onStep,
        onToken,
        onStreamReset,
        onTokens,
        onRoute: (routedResponse) => {
          dispatch({ type: "turn/speaker", speaker: modelSpeakerLabel(routedResponse.meta) });
        },
      });
      const response = executedTurn.response;
      const routeTag = formatRouteTag(response);
      if (routeTag) {
        dispatch({ type: "assistant/appended", message: routeTag });
      }
      if (turn.contextReceipt?.length) {
        dispatch({ type: "assistant/appended", message: `Context: ${turn.contextReceipt.join(" · ")}` });
      }
      let autoApprovedShellContent: string | null = null;
      let autoApprovedShellFailed = false;

      for (const toolExecution of executedTurn.toolExecutions) {
        dispatch({
          type: "tool/executed",
          tool: toolExecution.tool,
          summary: toolExecution.summary,
          ok: toolExecution.ok,
        });

        if (toolExecution.patch && toolExecution.changedFile) {
          dispatch({
            type: "patch/updated",
            patch: toolExecution.patch,
            changedFile: toolExecution.changedFile,
          });
        }

        if (toolExecution.travel) {
          dispatch({
            type: "travel/completed",
            toPath: toolExecution.travel.toPath,
            label: toolExecution.travel.label,
            workspace: toolExecution.travel.workspace,
          });
          void loadAllAgents().then((agents) => {
            setAvailableAgents(agents);
          });
        }

        if (toolExecution.shellPending && alwaysApprovedShellCommands.has(toolExecution.shellPending.command)) {
          const shellCwd = state.workspace?.cwd ?? process.cwd();
          dispatch({
            type: "assistant/appended",
            message: "Auto-approved remembered shell command.",
          });
          try {
            const result = await runShellString(toolExecution.shellPending.command, shellCwd);
            if (!result.ok) {
              throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
            }
            autoApprovedShellContent = formatShellCompletion(result);
          } catch (err: any) {
            autoApprovedShellFailed = true;
            dispatch({ type: "turn/failed", error: `Shell failed: ${err.message}` });
          }
          continue;
        }

        if (toolExecution.shellPending) {
          dispatch({
            type: "shell/staged",
            command: toolExecution.shellPending.command,
            reason: toolExecution.shellPending.reason,
          });
        }
      }

      if (autoApprovedShellFailed) {
        setTurnThoughts([]);
        return;
      }

      const assistantContent =
        autoApprovedShellContent ||
        extractAssistantText(response) ||
        synthesizeAssistantFallback(value, executedTurn.toolExecutions, workspace);

      if (assistantContent) {
        dispatch({ type: "turn/tokens", count: Math.max(1, Math.round(assistantContent.length / 4)) });
        // Streaming already populated streamingText token-by-token — don't overwrite.
        // Only set it explicitly for tool-only turns where onToken never fired.
        if (!didStream) {
          dispatch({ type: "turn/response", content: assistantContent });
        }
      } else if (executedTurn.toolExecutions.length > 0) {
        dispatch({
          type: "assistant/appended",
          message: "Turn completed after local tool work, but the model returned no final assistant text.",
        });
      } else {
        dispatch({
          type: "assistant/appended",
          message: "The model returned no assistant text for this turn.",
        });
      }

      // When streaming fired, streamingText already has the content — pass undefined
      // so turn/completed falls back to state.streamingText in the reducer.
      dispatch({ type: "turn/completed", content: didStream ? undefined : assistantContent });
      void saveTraceRecord({
        assistantContent,
        cwd: workspace?.cwd ?? process.cwd(),
        executedTurn,
        runtimeLane,
        toolMode,
        sessionId: state.sessionId,
        turn,
        userPrompt: value,
        workspace,
      }).catch(() => {});
      setTurnThoughts([]);

      // If a plan is running, advance it after the turn completes
      if (state.activePlan?.status === "running") {
        dispatch({ type: "plan/step-complete" });
      }

      // Auto-title on the first real turn, then auto-save
      if (!state.sessionTitle) {
        const firstReal = state.conversation.find(m => m.role === "user" && !String(m.content).startsWith("/"));
        if (firstReal) {
          const raw = String(firstReal.content);
          const title = raw.slice(0, 60) + (raw.length > 60 ? "…" : "");
          dispatch({ type: "session/title-set", title });
        }
      }
      // Auto-save after every completed turn
      void savePersistedSession({ ...state, updatedAt: Date.now() });

      refreshWorkspace().then((ws) => {
        dispatch({ type: "workspace/updated", workspace: ws });
      }).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "turn/failed",
        error: `Request failed: ${msg}`,
      });
      setTurnThoughts([]);
    }
  }

  async function handleCreateAgentComplete(answers: CreateAgentAnswers) {
    setCreateAgentGenerating(true);
    try {
      const draft = await generateAgentDefinition(runtimeClient, surface, answers);
      setComposerMode("default");
      setCreateAgentGenerating(false);
      setPendingAgentDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** agent definition:\n\n\`\`\`\n${draft.content}\n\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreateAgentGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate agent: ${e.message}` });
    }
  }

  async function handleCreateEngineComplete(answers: CreateEngineAnswers) {
    setCreateEngineGenerating(true);
    try {
      const cloudClient = createRuntimeClient("cloud");
      const draft = await generateEngineManifest(cloudClient, surface, answers);
      setComposerMode("default");
      setCreateEngineGenerating(false);
      setPendingEngineDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** engine manifest:\n\n\`\`\`json\n${draft.content}\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreateEngineGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate engine: ${e.message}` });
    }
  }

  async function handleCreateMcpComplete(answers: CreateMcpAnswers) {
    setCreateMcpGenerating(true);
    try {
      const cloudClient = createRuntimeClient("cloud");
      const draft = await generateSwitchbayMcpConfig(cloudClient, surface, answers);
      setComposerMode("default");
      setCreateMcpGenerating(false);
      setPendingMcpDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** MCP config:\n\n\`\`\`json\n${draft.content}\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreateMcpGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate MCP config: ${e.message}` });
    }
  }

  async function handleCreateRuleComplete(answers: CreateRuleAnswers) {
    setCreateRuleGenerating(true);
    try {
      const draft = await generateRuleDefinition(answers, state.workspace?.cwd ?? process.cwd());
      setComposerMode("default");
      setCreateRuleGenerating(false);
      setPendingRuleDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** rule:\n\n\`\`\`markdown\n${draft.content}\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreateRuleGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate rule: ${e.message}` });
    }
  }

  async function handleCreateSkillComplete(answers: CreateSkillAnswers) {
    setCreateSkillGenerating(true);
    try {
      const draft = await generateSkillDefinition(runtimeClient, surface, answers);
      setComposerMode("default");
      setCreateSkillGenerating(false);
      setPendingSkillDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** skill:\n\n\`\`\`markdown\n${draft.content}\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreateSkillGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate skill: ${e.message}` });
    }
  }

  async function handleCreatePluginComplete(answers: CreatePluginAnswers) {
    setCreatePluginGenerating(true);
    try {
      const draft = await generatePluginDefinition(answers, state.workspace?.cwd ?? process.cwd());
      setComposerMode("default");
      setCreatePluginGenerating(false);
      setPendingPluginDraft(draft);
      dispatch({
        type: "assistant/appended",
        message: `Here's your **${draft.name}** plugin manifest:\n\n\`\`\`json\n${draft.content}\`\`\`\n\nSave path: \`${draft.savePath}\`\n\n**y** to save · **n** to discard`,
      });
    } catch (e: any) {
      setComposerMode("default");
      setCreatePluginGenerating(false);
      dispatch({ type: "assistant/appended", message: `Failed to generate plugin: ${e.message}` });
    }
  }

  async function handleEditIntentSubmit(value: string) {
    if (!selectedEditFile || !value.trim()) {
      return;
    }

    const command = `/edit ${selectedEditFile} ::: ${value}`;
    setEditIntent("");
    setSelectedEditFile(null);
    setComposerMode("default");
    await handleSubmit(command);
  }

  useEffect(() => {
    if (!pendingLaneFollowUp || pendingLaneSuggestion || runtimeLane !== pendingLaneFollowUp.lane) return;
    const followUp = pendingLaneFollowUp.input;
    setPendingLaneFollowUp(null);
    laneGateBypassRef.current = true;
    void handleSubmit(followUp);
  }, [pendingLaneFollowUp, pendingLaneSuggestion, runtimeLane]);

  useEffect(() => {
    if (!pendingAgentFollowUp || !state.activeAgentId) return;
    const followUp = pendingAgentFollowUp;
    setPendingAgentFollowUp(null);
    void handleSubmit(followUp);
  }, [pendingAgentFollowUp, state.activeAgentId]);

  useEffect(() => {
    if (initialQuery) {
      void handleSubmit(initialQuery);
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (composerMode === "edit_intent" || composerMode === "resume_picker" || composerMode === "agent_picker" || composerMode === "model_picker" || composerMode === "skill_picker" || composerMode === "create_agent" || composerMode === "create_engine" || composerMode === "create_mcp" || composerMode === "create_rule" || composerMode === "create_skill" || composerMode === "create_plugin" || composerMode === "shortcut_picker") {
      return;
    }

    if (trimmed === "/edit" || trimmed.startsWith("/edit ")) {
      setComposerMode("edit_file_picker");
      return;
    }

    if (composerMode === "edit_file_picker" && !trimmed.startsWith("/edit")) {
      setComposerMode("default");
    }
  }, [composerMode, query]);

  useEffect(() => {
    if (mentionPartial === null) {
      setMentionCandidates([]);
      setSelectedMentionIndex(0);
      return;
    }
    const cwd = state.workspace?.cwd ?? process.cwd();
    listMentionCandidates(cwd, mentionPartial).then((candidates) => {
      setMentionCandidates(candidates);
      setSelectedMentionIndex(0);
    }).catch(() => {});
  }, [mentionPartial, state.workspace?.cwd]);

  return (
    <Box width={stdoutWidth} height={stdoutHeight} overflowY="hidden">
      <Box flexDirection="column" width={mainWidth} height={stdoutHeight} overflowY="hidden">
        {state.transcript.length > 0 && (
          <Header
            lane={runtimeBadge}
            mode={mode}
            profile={state.resolvedProfile}
            status={state.status}
            terminalWidth={mainWidth}
            workspace={state.workspace}
            activeAgentId={state.activeAgentId}
            availableAgents={availableAgents}
          />
        )}
        <Box height={transcriptAreaHeight} flexDirection="column" overflowY="hidden">
          <Transcript
            lane={runtimeBadge}
            entries={visibleTranscriptEntries}
            hasMoreAbove={transcriptStartIndex > 0}
            hasMoreBelow={transcriptEndIndex < totalTranscriptEntries}
            pendingApproval={state.pendingApproval}
            pendingAgentDraft={pendingAgentDraft}
            activePlan={state.activePlan}
            scrollOffset={clampedScrollOffset}
            streamingText={state.streamingText}
            streamingSpeaker={state.activeSpeaker}
            terminalWidth={mainWidth}
          />
        </Box>
        <EditDrawer
          files={editPickerState.files}
          selectedIndex={selectedEditFileIndex}
          visible={editPickerState.visible}
        />
        <EditIntentDrawer
          file={selectedEditFile ?? ""}
          onChange={setEditIntent}
          onSubmit={handleEditIntentSubmit}
          value={editIntent}
          visible={composerMode === "edit_intent" && Boolean(selectedEditFile)}
        />
        <ResumeDrawer
          sessions={resumeSessions}
          selectedIndex={selectedResumeIndex}
          visible={resumeDrawerVisible}
        />
        <AgentDrawer
          agents={availableAgents}
          activeAgentId={state.activeAgentId}
          selectedIndex={selectedAgentIndex}
          visible={composerMode === "agent_picker"}
        />
        <EngineDrawer
          items={engineDrawerItems}
          selectedIndex={selectedEngineIndex}
          visible={engineDrawerVisible}
        />
        <ModelDrawer
          activeModel={activeRuntimeModel}
          items={availableModels}
          notice={modelDrawerNotice}
          selectedIndex={selectedModelIndex}
          visible={modelDrawerVisible}
        />
        <SkillDrawer
          items={availableSkills}
          notice={skillDrawerNotice}
          selectedIndex={selectedSkillIndex}
          visible={skillDrawerVisible}
        />
        <CreateAgentDrawer
          visible={composerMode === "create_agent" || createAgentGenerating}
          generating={createAgentGenerating}
          onComplete={handleCreateAgentComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <CreateEngineDrawer
          visible={composerMode === "create_engine" || createEngineGenerating}
          generating={createEngineGenerating}
          onComplete={handleCreateEngineComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <CreateMcpDrawer
          visible={composerMode === "create_mcp" || createMcpGenerating}
          generating={createMcpGenerating}
          onComplete={handleCreateMcpComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <CreateRuleDrawer
          visible={composerMode === "create_rule" || createRuleGenerating}
          generating={createRuleGenerating}
          onComplete={handleCreateRuleComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <CreateSkillDrawer
          visible={composerMode === "create_skill" || createSkillGenerating}
          generating={createSkillGenerating}
          onComplete={handleCreateSkillComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <CreatePluginDrawer
          visible={composerMode === "create_plugin" || createPluginGenerating}
          generating={createPluginGenerating}
          onComplete={handleCreatePluginComplete}
          onCancel={() => { setComposerMode("default"); setQuerySync(""); }}
        />
        <ShortcutDrawer
          visible={shortcutDrawerVisible}
        />
        <CommandDrawer
          commands={commandMatches}
          selectedIndex={selectedCommandIndex}
          visible={commandDrawerVisible}
        />
        <MentionPicker
          candidates={mentionCandidates}
          selectedIndex={selectedMentionIndex}
          visible={mentionPickerVisible}
        />
        <Composer
          disabled={composerMode === "edit_intent" || composerMode === "create_agent" || composerMode === "create_engine" || composerMode === "create_mcp" || composerMode === "create_rule" || composerMode === "create_skill" || composerMode === "create_plugin"}
          initialQuery={initialQuery}
          pendingApprovalKind={
            pendingEngineDraft ? "engine_draft" :
            pendingMcpDraft ? "mcp_draft" :
            pendingRuleDraft ? "rule_draft" :
            pendingSkillDraft ? "skill_draft" :
            pendingPluginDraft ? "plugin_draft" :
            pendingLaneSuggestion ? "lane_suggestion" :
            pendingAgentDraft ? "agent_draft" :
            state.activePlan?.status === "pending_approval" ? "plan_approval" :
            state.activePlan?.status === "awaiting_continue" ? "plan_continue" :
            (state.pendingApproval?.kind ?? null)
          }
          query={query}
          status={state.status}
          thoughts={turnThoughts}
          turnStartedAt={state.turnStartedAt}
          turnTokenCount={state.turnTokenCount}
        />
      </Box>
      {showRightRail ? (
        <RightRail
          activeAgentId={state.activeAgentId}
          activeSteps={turnThoughts}
          availableAgents={availableAgents}
          changedFiles={state.changedFiles}
          dailyBoard={operatorConfig.enabled && operatorConfig.dailyBoard ? dailyBoard : null}
          mode={mode}
          recentActivity={state.recentActivity}
          runtimeBadge={runtimeBadge}
          status={state.status}
          thoughts={state.thoughts}
          transcript={state.transcript}
          workspace={state.workspace}
          width={rightRailWidth}
        />
      ) : null}
    </Box>
  );
}

function appendTurnThought(previous: string[], value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || previous.at(-1) === normalized) return previous;
  return [...previous, normalized].slice(-6);
}

function isSwitchbayCheckpointLine(line: string): boolean {
  return /\bswitchbay:\s*/.test(line);
}

function formatShellCompletion(result: ShellResult): string {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (!output) return "Shell command completed.";

  const maxOutputLength = 900;
  const clipped = output.length > maxOutputLength
    ? `${output.slice(0, maxOutputLength).trimEnd()}\n...`
    : output;

  return `Shell command completed.\n\nOutput:\n\`\`\`text\n${clipped}\n\`\`\``;
}

export function sliceTranscriptForRows(
  entries: ReturnType<typeof createTranscriptEntry>[],
  endIndex: number,
  maxRows: number,
  terminalWidth: number,
) {
  const safeEnd = Math.max(0, Math.min(endIndex, entries.length));
  const visible: ReturnType<typeof createTranscriptEntry>[] = [];
  let usedRows = 0;

  for (let index = safeEnd - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const rows = estimateTranscriptRows(entry, terminalWidth);
    if (visible.length > 0 && usedRows + rows > maxRows) {
      // Never show a model reply without the user turn that prompted it. Width
      // changes (such as /collapse) may overflow the row estimate, but keeping
      // the pair intact is less confusing than visually erasing user input.
      const completesVisibleTurn = entry.kind === "user" && visible.some((item) => item.kind === "assistant");
      if (!completesVisibleTurn) break;
      visible.unshift(entry);
      usedRows += rows;
      break;
    }
    visible.unshift(entry);
    usedRows += rows;
  }

  return {
    entries: visible,
    startIndex: Math.max(0, safeEnd - visible.length),
  };
}

function estimateTranscriptRows(
  entry: ReturnType<typeof createTranscriptEntry>,
  terminalWidth: number,
) {
  // Markdown has indentation, a model label, and ANSI/unicode display width that
  // a raw string length cannot fully capture. Biasing a little narrower avoids
  // rendering a partial lower line in Ink's fixed-height viewport.
  const contentWidth = Math.max(30, terminalWidth - 12);
  const rawLines = String(entry.body || entry.title || "").split("\n");
  const wrappedLines = rawLines.reduce((sum, line) => (
    sum + Math.max(1, Math.ceil(line.length / contentWidth))
  ), 0);

  if (entry.kind === "assistant") return Math.max(2, wrappedLines + 1);
  if (entry.kind === "user") return Math.max(1, wrappedLines + 1);
  return Math.max(1, wrappedLines);
}
