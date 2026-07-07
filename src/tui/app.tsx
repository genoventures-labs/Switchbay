import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useInput, useStdout } from "ink";
import {
  buildTurn,
  executeTurn,
  extractAssistantText,
  refreshWorkspace,
  synthesizeAssistantFallback,
} from "../agent/loop";
import { parseApprovalIntent, tryLocalCommand } from "../agent/commands";
import { resolveAgentPolicy } from "../agent/policy";
import type { ChatRuntimeClient } from "../runtime/client";
import { getRuntimeLaneLabel } from "../runtime/client";
import type { RuntimeLane } from "../config/env";
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
import { generateAgentDefinition, generatePlan, type PendingAgentDraft } from "../agent/loop";
import type { ActivePlan } from "../agent/turn-state";
import { ShortcutDrawer } from "./components/ShortcutDrawer";
import { getCommandMatches } from "./commands";
import { runCommand, runShellString } from "../tools/shell";
import { loadEngineRegistry, type EngineManifest } from "../engines/registry";

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

type ComposerMode = "default" | "edit_file_picker" | "edit_intent" | "resume_picker" | "agent_picker" | "engine_picker" | "create_agent" | "shortcut_picker";

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
  const [createAgentGenerating, setCreateAgentGenerating] = useState(false);
  const [pendingAgentDraft, setPendingAgentDraft] = useState<PendingAgentDraft | null>(null);
  const [turnThoughts, setTurnThoughts] = useState<string[]>([]);
  const [alwaysApprovedShellCommands, setAlwaysApprovedShellCommands] = useState<Set<string>>(() => new Set());
  
  const didHydrateRef = useRef(false);
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

  const commandMatches = useMemo(() => getCommandMatches(query), [query]);
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
  const engineDrawerItems = useMemo(() => flattenEngineDrawerItems(availableEngines), [availableEngines]);

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

  const headerRows = state.transcript.length > 0 ? 5 : 0;
  const composerRows = initialQuery ? 3 : state.status === "THINKING" ? Math.min(7, 4 + turnThoughts.length) : 4;
  const drawerRows =
    commandDrawerVisible || mentionPickerVisible || resumeDrawerVisible || shortcutDrawerVisible ||
    editPickerState.visible || composerMode === "agent_picker" || engineDrawerVisible || composerMode === "create_agent"
      ? 10
      : composerMode === "edit_intent"
        ? 5
        : 0;
  const transcriptAreaHeight = Math.max(5, stdoutHeight - headerRows - composerRows - drawerRows);
  const totalTranscriptEntries = state.transcript.length;
  const transcriptScrollPage = Math.max(3, Math.floor(transcriptAreaHeight / 2));
  const maxTranscriptScrollOffset = Math.max(0, totalTranscriptEntries - 1);
  const clampedScrollOffset = Math.min(
    transcriptScrollOffset,
    maxTranscriptScrollOffset,
  );
  const transcriptEndIndex = Math.max(0, totalTranscriptEntries - clampedScrollOffset);
  const { entries: visibleTranscriptEntries, startIndex: transcriptStartIndex } = useMemo(
    () => sliceTranscriptForRows(state.transcript, transcriptEndIndex, transcriptAreaHeight, stdoutWidth),
    [state.transcript, transcriptEndIndex, transcriptAreaHeight, stdoutWidth],
  );
  function acceptMention(candidate: MentionCandidate) {
    const next = queryRef.current.replace(/@([\w./\-]*)$/, `@${candidate.value}${candidate.isDir ? "/" : ""} `);
    queryRef.current = next;
    setQuery(next);
    setMentionCandidates([]);
    setSelectedMentionIndex(0);
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

    if (shortcutDrawerVisible) {
        if (key.escape || key.return) {
            setComposerMode("default");
            setQuerySync("");
        }
        return;
    }

    const agentPickerVisible = composerMode === "agent_picker";
    const enginePickerVisible = composerMode === "engine_picker";
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
          message: { role: "user", content: intent === "always" ? `approve always: ${shellCmd.command}` : `approve: ${shellCmd.command}` },
          objective: `Run: ${shellCmd.command}`,
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
          const output = [result.stdout, result.stderr].filter(Boolean).join("\n") || "Done.";
          dispatch({ type: "turn/completed", content: `\`${shellCmd.command}\`\n\n${output}` });
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

    const workspace = state.workspace ?? (await refreshWorkspace());
    if (!state.workspace) {
      dispatch({ type: "workspace/updated", workspace });
    }

    const onStep = (title: string) => {
        setTurnThoughts([title]);
    };
    const onTokens = (count: number) => {
        dispatch({ type: "turn/tokens", count });
    };
    let didStream = false;
    const onToken = (token: string) => {
      didStream = true;
      dispatch({ type: "turn/token", token });
    };
    setTurnThoughts([]);

    const localCommand = await tryLocalCommand(trimmedVal, {
      client,
      profile: state.resolvedProfile,
      sessionId: state.sessionId,
      surface,
      workspace,
      conversation: state.conversation,
      lastChangedFile: state.changedFiles[state.changedFiles.length - 1] ?? null,
      activeAgentId: state.activeAgentId,
    });
    if (localCommand.handled) {
      dispatch({
        type: "turn/submitted",
        message: { role: "user", content: value },
        objective: state.currentObjective ?? "Process a local command.",
        pendingPlan: state.pendingPlan,
        mode: state.mode,
        resolvedProfile: state.resolvedProfile,
      });

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
      }

      // ── /plan ────────────────────────────────────────────────────────────
      if (localCommand.planGoal) {
        const goal = localCommand.planGoal;
        const cwd = state.workspace?.cwd ?? process.cwd();
        dispatch({ type: "assistant/appended", message: `Planning: _${goal}_…` });
        try {
          const steps = await generatePlan(client, surface, goal, cwd);
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

      if ("activateAgent" in localCommand) {
        dispatch({ type: "agent/activated", agentId: localCommand.activateAgent ?? null });
        dispatch({
          type: "assistant/appended",
          message: localCommand.assistantMessage ?? (localCommand.activateAgent ? "Agent activated." : "Agent deactivated."),
        });
        return;
      }

      if (localCommand.clearTranscript) {
        dispatch({ type: "transcript/cleared" });
        if (localCommand.compactedConversation) {
          dispatch({ type: "conversation/replaced", messages: localCommand.compactedConversation });
          dispatch({ type: "assistant/appended", message: localCommand.assistantMessage ?? "Session compacted." });
        }
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

    const { mentions, cleanQuery } = parseMentions(value);
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

    const turn = await buildTurn({
      input: effectiveInput,
      mode,
      profile,
      previousObjective: state.currentObjective,
      transcript: state.conversation,
      workspace,
      activeAgentId: state.activeAgentId,
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
        client,
        cwd: process.cwd(),
        sessionId: state.sessionId,
        surface,
        turn,
        workspace,
        onStep,
        onToken,
        onTokens,
      });
      const response = executedTurn.response;
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
        }

        if (toolExecution.shellPending && alwaysApprovedShellCommands.has(toolExecution.shellPending.command)) {
          const shellCwd = state.workspace?.cwd ?? process.cwd();
          dispatch({
            type: "assistant/appended",
            message: `Auto-approved remembered command:\n\`${toolExecution.shellPending.command}\``,
          });
          try {
            const result = await runShellString(toolExecution.shellPending.command, shellCwd);
            if (!result.ok) {
              throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
            }
            const output = [result.stdout, result.stderr].filter(Boolean).join("\n") || "Done.";
            autoApprovedShellContent = `\`${toolExecution.shellPending.command}\`\n\n${output}`;
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
      const draft = await generateAgentDefinition(client, surface, answers);
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
    if (initialQuery) {
      void handleSubmit(initialQuery);
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (composerMode === "edit_intent" || composerMode === "resume_picker" || composerMode === "agent_picker" || composerMode === "create_agent" || composerMode === "shortcut_picker") {
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
    <Box flexDirection="column" width={stdoutWidth} height={stdoutHeight} overflowY="hidden">
      {state.transcript.length > 0 && (
        <Header
          lane={getRuntimeLaneLabel(lane)}
          mode={mode}
          profile={state.resolvedProfile}
          status={state.status}
          terminalWidth={stdoutWidth}
          workspace={state.workspace}
          activeAgentId={state.activeAgentId}
          availableAgents={availableAgents}
        />
      )}
      <Box height={transcriptAreaHeight} flexDirection="column" overflowY="hidden">
        <Transcript
          lane={getRuntimeLaneLabel(lane)}
          entries={visibleTranscriptEntries}
          hasMoreAbove={transcriptStartIndex > 0}
          hasMoreBelow={transcriptEndIndex < totalTranscriptEntries}
          pendingApproval={state.pendingApproval}
          pendingAgentDraft={pendingAgentDraft}
          activePlan={state.activePlan}
          scrollOffset={clampedScrollOffset}
          streamingText={state.streamingText}
          terminalWidth={stdoutWidth}
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
      <CreateAgentDrawer
        visible={composerMode === "create_agent" || createAgentGenerating}
        generating={createAgentGenerating}
        onComplete={handleCreateAgentComplete}
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
        disabled={composerMode === "edit_intent"}
        initialQuery={initialQuery}
        pendingApprovalKind={
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
  );
}

function isSwitchbayCheckpointLine(line: string): boolean {
  return /\bswitchbay:\s*/.test(line);
}

function sliceTranscriptForRows(
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
  const contentWidth = Math.max(36, terminalWidth - 8);
  const rawLines = String(entry.body || entry.title || "").split("\n");
  const wrappedLines = rawLines.reduce((sum, line) => (
    sum + Math.max(1, Math.ceil(line.length / contentWidth))
  ), 0);

  if (entry.kind === "assistant") return Math.max(2, wrappedLines + 1);
  if (entry.kind === "user") return Math.max(1, wrappedLines + 1);
  return Math.max(1, wrappedLines);
}
