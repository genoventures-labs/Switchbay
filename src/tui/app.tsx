import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useInput, useStdout } from "ink";
import { getWebSocketBase } from "../config/env";
import {
  buildTurn,
  executeTurn,
  parseApprovalIntent,
  refreshWorkspace,
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
import { CommandDrawer } from "./components/CommandDrawer";
import { Composer } from "./components/Composer";
import { EditDrawer } from "./components/EditDrawer";
import { EditIntentDrawer } from "./components/EditIntentDrawer";
import { Header } from "./components/Header";
import { MentionPicker } from "./components/MentionPicker";
import { Transcript } from "./components/Transcript";
import { ResumeDrawer } from "./components/ResumeDrawer";
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

type ComposerMode = "default" | "edit_file_picker" | "edit_intent" | "resume_picker";

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
  const didHydrateRef = useRef(false);
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

  // Detect the active @mention partial — last @word in the query
  const mentionPartial = useMemo(() => {
    const match = query.match(/@([\w./\-]*)$/);
    return match ? match[1] : null;
  }, [query]);
  const mentionPickerVisible = mentionPartial !== null && composerMode === "default" && !commandDrawerVisible;
  
  const resumeDrawerVisible = composerMode === "resume_picker";

  // Dynamic transcript window based on terminal height
  const transcriptWindowSize = Math.max(5, stdoutHeight - 12);
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
          setQuerySync(`${selectedCommand.command} `);
          setSelectedCommandIndex(0);
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
        void handleSubmit(queryRef.current);
        return;
      }
      if (key.escape) {
        setQuerySync("");
        setSelectedCommandIndex(0);
        setComposerMode("default");
        setTranscriptScrollOffset(0);
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
          // Ignore malformed stream events.
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

  async function handleSubmit(value: string) {
    if (!value.trim()) {
      return;
    }
    
    if (value.trim() === "/sessions") {
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
      setQuerySync("");
      return;
    }

    if (value.trim().startsWith("/purge")) {
      const parts = value.trim().split(" ");
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
      setQuerySync("");
      return;
    }

    if (value.trim() === "/save") {
      await savePersistedSession(state);
      dispatch({
        type: "assistant/appended",
        message: "I’ve saved the current session state.",
      });
      setQuerySync("");
      return;
    }

    if (value.trim() === "/resume") {
      const sessions = await listSessions();
      setResumeSessions(sessions);
      setSelectedResumeIndex(0);
      setComposerMode("resume_picker");
      return;
    }

    if (resolvedValue.trim() === "/new") {
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
      setQuerySync("");
      setComposerMode("default");
      setTranscriptScrollOffset(0);
      setThinkingCollapsed(false);
      setSelectedEditFile(null);
      setEditIntent("");
      return;
    }

    const approvalIntent =
      state.pendingApproval || state.pendingDraft || state.pendingPlanDraft
        ? parseApprovalIntent(value)
        : null;
    const resolvedValue =
      approvalIntent === "apply"
        ? "/apply"
        : approvalIntent === "cancel"
          ? "/cancel"
          : value;

    if (resolvedValue.trim() === "/clear") {
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
      setQuerySync("");
      setComposerMode("default");
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

    setQuerySync("");
    setComposerMode("default");

    const localCommand = await tryLocalCommand(resolvedValue, {
      client,
      profile: state.resolvedProfile,
      sessionId: state.sessionId,
      surface,
      workspace,
      pendingDraft: state.pendingDraft,
      pendingPlanDraft: state.pendingPlanDraft,
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
            type: resolvedValue.trim() === "/apply" ? "approval/approved" : "approval/rejected",
            requestId: state.pendingApproval.id,
          });
        }
        dispatch({ type: "draft/cleared" });
      }

      if (localCommand.clearPlanDraft) {
        if (state.pendingApproval) {
          dispatch({
            type: resolvedValue.trim() === "/apply" ? "approval/approved" : "approval/rejected",
            requestId: state.pendingApproval.id,
          });
        }
        dispatch({ type: "plan/cleared" });
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

    const turn = buildTurn({
      input: effectiveInput,
      mode,
      profile,
      previousObjective: state.currentObjective,
      transcript: state.conversation,
      workspace,
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
      }

      const assistantContent = response.choices?.[0]?.message?.content?.trim();

      if (assistantContent) {
        dispatch({
          type: "turn/response",
          content: assistantContent,
        });
      }

      dispatch({
        type: "scratchpad/updated",
        scratchpad: response.meta?.scratchpad ?? null,
      });

      dispatch({ type: "turn/completed" });

      refreshWorkspace().then((ws) => {
        dispatch({ type: "workspace/updated", workspace: ws });
      }).catch(() => {});
    } catch {
      dispatch({
        type: "turn/failed",
        error: "Request failed. Check ORI_API_KEY and runtime connectivity.",
      });
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

    if (composerMode === "edit_intent" || composerMode === "resume_picker") {
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
    <Box flexDirection="column" width={stdoutWidth} height={stdoutHeight}>
      {state.transcript.length > 0 && (
        <Header
          mode={mode}
          profile={state.resolvedProfile}
          status={state.status}
          workspace={state.workspace}
        />
      )}
      <Transcript
        activeCapability={state.activeCapability}
        entries={visibleTranscriptEntries}
        hasMoreAbove={transcriptStartIndex > 0}
        hasMoreBelow={transcriptEndIndex < totalTranscriptEntries}
        pendingApproval={state.pendingApproval}
        pendingDraft={state.pendingDraft}
        scrollOffset={clampedScrollOffset}
        streamingText={state.streamingText}
        thinking={thinkingCollapsed ? null : (state.thoughts[0]?.summary ?? null)}
        terminalWidth={stdoutWidth}
      />
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
        query={query}
        status={state.status}
      />
    </Box>
  );
}
