import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useInput, useStdout } from "ink";
import { getWebSocketBase } from "../config/env";
import {
  buildTurn,
  executeTurn,
  extractAssistantText,
  parseApprovalIntent,
  refreshWorkspace,
  synthesizeAssistantFallback,
  tryLocalCommand,
} from "../agent/loop";
import { resolveAgentPolicy } from "../agent/policy";
import { OriClient } from "../runtime/ori-client";
import { createSessionStore, sessionReducer } from "../session/store";
import { createTranscriptEntry } from "../agent/turn-state";
import { loadPersistedSession, savePersistedSession, listSessions, purgeSessions } from "../session/persistence";
import {
  listMentionCandidates,
  parseMentions,
  resolveMentionContent,
  type MentionCandidate,
} from "../tools/mentions";
import { listAvailableBundles, type Bundle } from "../tools/bundles";
import { loadAllAgents, type Agent } from "../agent/agents";
import { CommandDrawer } from "./components/CommandDrawer";
import { Composer } from "./components/Composer";
import { EditDrawer } from "./components/EditDrawer";
import { EditIntentDrawer } from "./components/EditIntentDrawer";
import { Header } from "./components/Header";
import { MentionPicker } from "./components/MentionPicker";
import { Transcript } from "./components/Transcript";
import { ResumeDrawer } from "./components/ResumeDrawer";
import { BundleDrawer } from "./components/BundleDrawer";
import { AgentDrawer } from "./components/AgentDrawer";
import { CreateAgentDrawer, type CreateAgentAnswers } from "./components/CreateAgentDrawer";
import { generateAgentDefinition, type PendingAgentDraft } from "../agent/loop";
import { ShortcutDrawer } from "./components/ShortcutDrawer";
import { getCommandMatches } from "./commands";

export type OriAppProps = {
  client: OriClient;
  initialHopLabel: string | null;
  initialQuery: string;
  mode: string;
  profile: string;
  surface: string;
  resumeId?: string | null;
};

type StreamEvent =
  | { type: "agent_dispatch"; action?: string }
  | { type: "token"; content?: string }
  | { type: "done" };

type ComposerMode = "default" | "edit_file_picker" | "edit_intent" | "resume_picker" | "bundle_picker" | "agent_picker" | "create_agent" | "shortcut_picker";

export function OriApp({
  client,
  initialHopLabel,
  initialQuery,
  mode,
  profile,
  surface,
  resumeId = null,
}: OriAppProps) {
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
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("default");
  const [editIntent, setEditIntent] = useState("");
  const [selectedEditFile, setSelectedEditFile] = useState<string | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedEditFileIndex, setSelectedEditFileIndex] = useState(0);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [resumeSessions, setResumeSessions] = useState<{id: string, title: string, updatedAt: number}[]>([]);
  const [selectedResumeIndex, setSelectedResumeIndex] = useState(0);
  const [availableBundles, setAvailableBundles] = useState<Bundle[]>([]);
  const [selectedBundleIndex, setSelectedBundleIndex] = useState(0);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [createAgentGenerating, setCreateAgentGenerating] = useState(false);
  const [pendingAgentDraft, setPendingAgentDraft] = useState<PendingAgentDraft | null>(null);
  const [turnThoughts, setTurnThoughts] = useState<string[]>([]);
  
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
  const bundleDrawerVisible = composerMode === "bundle_picker";
  const shortcutDrawerVisible = composerMode === "shortcut_picker";

  const transcriptWindowSize = Math.max(5, stdoutHeight - 15);
  const totalTranscriptEntries = state.transcript.length;
  const clampedScrollOffset = Math.min(
    transcriptScrollOffset,
    Math.max(0, totalTranscriptEntries - transcriptWindowSize),
  );
  const transcriptEndIndex = Math.max(0, totalTranscriptEntries - clampedScrollOffset);
  const transcriptStartIndex = Math.max(0, transcriptEndIndex - transcriptWindowSize);
  const visibleTranscriptEntries = state.transcript.slice(
    transcriptStartIndex,
    transcriptEndIndex,
  );
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
  }, [query, state.workspace?.recentFiles]);

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
      if (key.ctrl && input === "t") {
        setThinkingCollapsed((previous) => !previous);
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

    if (bundleDrawerVisible) {
      if (key.upArrow) {
        setSelectedBundleIndex((prev) =>
          prev <= 0 ? availableBundles.length - 1 : prev - 1,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedBundleIndex((prev) =>
          prev >= availableBundles.length - 1 ? 0 : prev + 1,
        );
        return;
      }
      if (key.return || key.tab) {
        const selected = availableBundles[selectedBundleIndex];
        if (selected) {
           void handleToggleBundle(selected.manifest.id);
        }
        return;
      }
      if (key.escape) {
        setComposerMode("default");
        setQuerySync("");
        return;
      }
    }

    const agentPickerVisible = composerMode === "agent_picker";
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

    if (key.ctrl && input === "t") {
      setThinkingCollapsed((previous) => !previous);
      return;
    }
    if (key.ctrl && input === "u") {
      setTranscriptScrollOffset((previous) =>
        Math.min(
          previous + Math.max(3, Math.floor(transcriptWindowSize / 2)),
          Math.max(0, totalTranscriptEntries - transcriptWindowSize),
        ),
      );
      return;
    }
    if (key.ctrl && input === "d") {
      setTranscriptScrollOffset((previous) =>
        Math.max(0, previous - Math.max(3, Math.floor(transcriptWindowSize / 2))),
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
          setQuerySync(historyRef.current[next]);
        }
        return;
      }
      if (key.downArrow && historyIndexRef.current >= 0) {
        const next = historyIndexRef.current - 1;
        historyIndexRef.current = next;
        setQuerySync(next >= 0 ? historyRef.current[next] : "");
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
    setTranscriptScrollOffset((previous) =>
      Math.min(previous, Math.max(0, state.transcript.length - transcriptWindowSize)),
    );
  }, [state.transcript.length, transcriptWindowSize]);

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
    
    void listAvailableBundles().then((bundles) => {
      setAvailableBundles(bundles);
    });
    void loadAllAgents().then((agents) => {
      setAvailableAgents(agents);
    });

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 2000;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(getWebSocketBase());

      ws.addEventListener("open", () => {
        reconnectDelay = 2000;
        dispatch({ type: "connection/opened" });
      });

      ws.addEventListener("message", (event) => {
        try {
          const payload =
            typeof event.data === "string" ? event.data : event.data.toString();
          const streamEvent = JSON.parse(payload) as StreamEvent;

          if (streamEvent.type === "agent_dispatch") {
            dispatch({
              type: "turn/capability",
              capability: streamEvent.action ?? "thinking",
            });
            return;
          }

          if (streamEvent.type === "token") {
            dispatch({
              type: "turn/token",
              token: streamEvent.content ?? "",
            });
            return;
          }

          if (streamEvent.type === "done") {
            dispatch({ type: "turn/completed" });
          }
        } catch {
        }
      });

      ws.addEventListener("close", () => {
        if (destroyed) return;
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        reconnectTimer = setTimeout(connect, reconnectDelay);
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
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

  async function handleToggleBundle(id: string) {
    const nextIds = state.activeBundleIds.includes(id)
      ? state.activeBundleIds.filter((bid) => bid !== id)
      : [...state.activeBundleIds, id];
    
    state.activeBundleIds = nextIds;
    dispatch({ type: "workspace/updated", workspace: state.workspace });
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
        list += "\nUse /resume to pick one, or ori-code --resume <index>";
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
        const count = parseInt(match[1], 10);
        const unit = match[2];
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

    if (trimmedVal === "/bundles") {
      const bundles = await listAvailableBundles();
      setAvailableBundles(bundles);
      setSelectedBundleIndex(0);
      setComposerMode("bundle_picker");
      return;
    }

    if (trimmedVal.startsWith("/bundle ")) {
      const id = trimmedVal.split(" ")[1];
      if (id) {
        await handleToggleBundle(id);
        const bundles = await listAvailableBundles();
        const bundle = bundles.find(b => b.manifest.id === id);
        dispatch({
            type: "assistant/appended",
            message: `Specialization "${bundle?.manifest.name || id}" is now ${state.activeBundleIds.includes(id) ? "enabled" : "disabled"}.`,
        });
      }
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
      setThinkingCollapsed(false);
      setSelectedEditFile(null);
      setEditIntent("");
      return;
    }

    // Pending agent draft approval — y to save, n to discard
    if (pendingAgentDraft) {
      const intent = parseApprovalIntent(trimmedVal);
      if (intent === "apply") {
        try {
          const dir = pendingAgentDraft.savePath.replace(/\/[^/]+$/, "");
          const { mkdir, writeFile: wf } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          await wf(pendingAgentDraft.savePath, pendingAgentDraft.content, "utf-8");
          const agents = await loadAllAgents();
          setAvailableAgents(agents);
          dispatch({
            type: "assistant/appended",
            message: `✓ Agent **${pendingAgentDraft.name}** saved to \`${pendingAgentDraft.savePath}\`\n\nActivate it with \`/${pendingAgentDraft.id}\` or via \`/agents\`.`,
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
      if (intent === "apply") {
        const shellCmd = state.pendingShell;
        const shellCwd = state.workspace?.cwd ?? process.cwd();
        dispatch({ type: "approval/approved", requestId: state.pendingApproval.id });
        dispatch({ type: "shell/cleared" });
        dispatch({
          type: "turn/submitted",
          message: { role: "user", content: trimmedVal },
          objective: `Run: ${shellCmd.command}`,
          pendingPlan: [],
          mode: state.mode,
          resolvedProfile: state.resolvedProfile,
        });
        dispatch({ type: "turn/started" });
        try {
          const { exec: nodeExec } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execP = promisify(nodeExec);
          const { stdout, stderr } = await execP(shellCmd.command, { cwd: shellCwd, maxBuffer: 1024 * 1024 * 4 });
          const output = [stdout, stderr].filter(Boolean).join("\n") || "Done.";
          dispatch({ type: "turn/completed", content: `\`${shellCmd.command}\`\n\n${output}` });
        } catch (err: any) {
          dispatch({ type: "turn/failed", error: `Shell failed: ${err.message}` });
        }
        return;
      }
      if (intent === "cancel") {
        dispatch({ type: "approval/rejected", requestId: state.pendingApproval.id });
        dispatch({ type: "shell/cleared" });
        dispatch({ type: "assistant/appended", message: "Canceled." });
        return;
      }
    }

    const approvalIntent =
      state.pendingApproval || state.pendingDraft || state.pendingPlanDraft
        ? parseApprovalIntent(trimmedVal)
        : null;
    const resolvedValue =
      approvalIntent === "apply"
        ? "/apply"
        : approvalIntent === "cancel"
          ? "/cancel"
          : trimmedVal;

    if (resolvedValue === "/clear") {
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
      setThinkingCollapsed(false);
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

    const activeBundles = availableBundles.filter(b => state.activeBundleIds.includes(b.manifest.id));

    const localCommand = await tryLocalCommand(resolvedValue, {
      client,
      profile: state.resolvedProfile,
      sessionId: state.sessionId,
      surface,
      workspace,
      pendingDraft: state.pendingDraft,
      pendingPlanDraft: state.pendingPlanDraft,
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

      if (localCommand.scratchpad !== undefined) {
        dispatch({
          type: "scratchpad/updated",
          scratchpad: localCommand.scratchpad,
        });
      }

      if (localCommand.patch && localCommand.changedFile) {
        dispatch({
          type: "patch/updated",
          patch: localCommand.patch,
          changedFile: localCommand.changedFile,
        });
      }

      if (localCommand.draft) {
        dispatch({
          type: "draft/staged",
          draft: localCommand.draft,
        });
      }

      if (localCommand.planDraft) {
        dispatch({
          type: "plan/staged",
          plan: localCommand.planDraft,
        });
      }

      if (localCommand.clearDraft) {
        if (state.pendingApproval) {
          dispatch({
            type: resolvedValue === "/apply" ? "approval/approved" : "approval/rejected",
            requestId: state.pendingApproval.id,
          });
        }
        dispatch({ type: "draft/cleared" });
      }

      if (localCommand.clearPlanDraft) {
        if (state.pendingApproval) {
          dispatch({
            type: resolvedValue === "/apply" ? "approval/approved" : "approval/rejected",
            requestId: state.pendingApproval.id,
          });
        }
        dispatch({ type: "plan/cleared" });
      }

      if (localCommand.clearDraft || localCommand.clearPlanDraft) {
        // also clear any pending shell if co-staged
        if (state.pendingShell) {
          dispatch({ type: "shell/cleared" });
        }
      }

      if (localCommand.verification) {
        dispatch({
          type: "verification/updated",
          verification: localCommand.verification,
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
      activeBundles,
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

      for (const toolExecution of executedTurn.toolExecutions) {
        dispatch({
          type: "tool/executed",
          tool: toolExecution.tool,
          summary: toolExecution.summary,
          ok: toolExecution.ok,
        });

        if (toolExecution.draft) {
          dispatch({
            type: "draft/staged",
            draft: toolExecution.draft,
          });
        }

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

        if (toolExecution.shellPending) {
          dispatch({
            type: "shell/staged",
            command: toolExecution.shellPending.command,
            reason: toolExecution.shellPending.reason,
          });
        }
      }

      const assistantContent =
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
          message: "Turn completed after local tool work, but ORI returned no final assistant text.",
        });
      } else {
        dispatch({
          type: "assistant/appended",
          message: "ORI returned no assistant text for this turn.",
        });
      }

      dispatch({
        type: "scratchpad/updated",
        scratchpad: response.meta?.scratchpad ?? null,
      });

      // When streaming fired, streamingText already has the content — pass undefined
      // so turn/completed falls back to state.streamingText in the reducer.
      dispatch({ type: "turn/completed", content: didStream ? undefined : assistantContent });
      setTurnThoughts([]);

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

    if (composerMode === "edit_intent" || composerMode === "resume_picker" || composerMode === "bundle_picker" || composerMode === "agent_picker" || composerMode === "create_agent" || composerMode === "shortcut_picker") {
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
          mode={mode}
          profile={state.resolvedProfile}
          status={state.status}
          workspace={state.workspace}
          activeAgentId={state.activeAgentId}
          availableAgents={availableAgents}
        />
      )}
      <Box flexGrow={1} flexDirection="column">
        <Transcript
          activeCapability={state.activeCapability}
          entries={visibleTranscriptEntries}
          hasMoreAbove={transcriptStartIndex > 0}
          hasMoreBelow={transcriptEndIndex < totalTranscriptEntries}
          pendingApproval={state.pendingApproval}
          pendingDraft={state.pendingDraft}
          pendingAgentDraft={pendingAgentDraft}
          scrollOffset={clampedScrollOffset}
          streamingText={state.streamingText}
          thinking={thinkingCollapsed ? null : (state.thoughts[0]?.summary ?? null)}
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
      <BundleDrawer
        bundles={availableBundles}
        activeBundleIds={state.activeBundleIds}
        selectedIndex={selectedBundleIndex}
        visible={bundleDrawerVisible}
      />
      <AgentDrawer
        agents={availableAgents}
        activeAgentId={state.activeAgentId}
        selectedIndex={selectedAgentIndex}
        visible={composerMode === "agent_picker"}
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
        activeCapability={state.activeCapability}
        disabled={composerMode === "edit_intent"}
        initialQuery={initialQuery}
        pendingApprovalKind={pendingAgentDraft ? "agent_draft" : (state.pendingApproval?.kind ?? null)}
        query={query}
        status={state.status}
        thoughts={turnThoughts}
        turnStartedAt={state.turnStartedAt}
        turnTokenCount={state.turnTokenCount}
      />
    </Box>
  );
}
