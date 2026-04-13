import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useInput } from "ink";
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
import { loadPersistedSession, savePersistedSession } from "../session/persistence";
import { ActivityFeed } from "./components/ActivityFeed";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { CommandDrawer } from "./components/CommandDrawer";
import { Composer } from "./components/Composer";
import { ContextPanel } from "./components/ContextPanel";
import { EditDrawer } from "./components/EditDrawer";
import { EditIntentDrawer } from "./components/EditIntentDrawer";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import { ThinkingPanel } from "./components/ThinkingPanel";
import { Transcript } from "./components/Transcript";
import { getCommandMatches } from "./commands";

export type OriAppProps = {
  client: OriClient;
  initialQuery: string;
  mode: string;
  profile: string;
  surface: string;
};

type StreamEvent =
  | { type: "agent_dispatch"; action?: string }
  | { type: "token"; content?: string }
  | { type: "done" };

type ComposerMode = "default" | "edit_file_picker" | "edit_intent";

export function OriApp({
  client,
  initialQuery,
  mode,
  profile,
  surface,
}: OriAppProps) {
  const stdoutWidth = process.stdout.columns ?? 120;
  const stdoutHeight = process.stdout.rows ?? 40;
  const [query, setQuery] = useState("");
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("default");
  const [editIntent, setEditIntent] = useState("");
  const [selectedEditFile, setSelectedEditFile] = useState<string | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedEditFileIndex, setSelectedEditFileIndex] = useState(0);
  const didHydrateRef = useRef(false);
  const initialPolicy = resolveAgentPolicy({ mode, profile });
  const [state, dispatch] = useReducer(
    sessionReducer,
    createSessionStore({
      mode: initialPolicy.mode,
      profile,
      resolvedProfile: initialPolicy.runtimeProfile,
      surface,
    }),
  );
  const commandMatches = useMemo(() => getCommandMatches(query), [query]);
  const commandDrawerVisible =
    !initialQuery && composerMode === "default" && query.trim().startsWith("/");
  const sidebarWidth = Math.max(28, Math.min(36, Math.floor(stdoutWidth * 0.28)));
  const mainWidth = Math.max(40, stdoutWidth - sidebarWidth - 3);
  const transcriptWindowSize = Math.max(8, stdoutHeight - 12);
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
          setQuery("");
          setSelectedEditFileIndex(0);
        }
        return;
      }

      if (key.escape) {
        setQuery("");
        setComposerMode("default");
        setSelectedEditFileIndex(0);
        return;
      }
    }

    if (!commandDrawerVisible) {
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

      return;
    }

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

      if (!selectedCommand) {
        return;
      }

      setQuery(`${selectedCommand.example} `);
      setSelectedCommandIndex(0);
      return;
    }

    if (key.escape) {
      setQuery("");
      setSelectedCommandIndex(0);
      setComposerMode("default");
      setTranscriptScrollOffset(0);
      return;
    }

    if (key.ctrl && input === "t") {
      setThinkingCollapsed((previous) => !previous);
      return;
    }

    if (input === "/" && query.length === 0) {
      setSelectedCommandIndex(0);
    }

    if (input === "/" && query.length === 0) {
      setComposerMode("default");
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
    void loadPersistedSession().then((persisted) => {
      if (persisted) {
        dispatch({ type: "session/hydrated", state: persisted });
      }

      didHydrateRef.current = true;
    });

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
              capability: streamEvent.action ?? "Thinking",
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
        // Reconnect silently with exponential backoff, cap at 30s.
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

  async function handleSubmit(value: string) {
    if (!value.trim()) {
      return;
    }

    const approvalIntent =
      state.pendingApproval || state.pendingDraft
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
      setQuery("");
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

    const localCommand = await tryLocalCommand(resolvedValue, {
      client,
      profile: state.resolvedProfile,
      sessionId: state.sessionId,
      surface,
      workspace,
      pendingDraft: state.pendingDraft,
    });
    if (localCommand.handled) {
      dispatch({
        type: "turn/submitted",
        message: { role: "user", content: value },
        objective: state.currentObjective ?? "Handle the local command.",
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

      if (localCommand.clearDraft) {
        if (state.pendingApproval) {
          dispatch({
            type: resolvedValue.trim() === "/apply" ? "approval/approved" : "approval/rejected",
            requestId: state.pendingApproval.id,
          });
        }
        dispatch({ type: "draft/cleared" });
      }

      if (localCommand.verification) {
        dispatch({
          type: "verification/updated",
          verification: localCommand.verification,
        });
      }

      dispatch({
        type: "assistant/appended",
        message:
          localCommand.assistantMessage ??
          "Local command ran, but it did not produce a message.",
      });
      setQuery("");
      setComposerMode("default");
      return;
    }

    const refreshedWorkspace = await refreshWorkspace();
    dispatch({ type: "workspace/updated", workspace: refreshedWorkspace });

    const turn = buildTurn({
      input: value,
      mode,
      profile,
      previousObjective: state.currentObjective,
      transcript: state.conversation,
      workspace: refreshedWorkspace,
    });

    dispatch({
      type: "turn/submitted",
      message: { role: "user", content: value },
      objective: turn.objective,
      pendingPlan: turn.pendingPlan,
      mode: turn.mode,
      resolvedProfile: turn.resolvedProfile,
    });

    setQuery("");
    dispatch({ type: "turn/started" });

    try {
      const executedTurn = await executeTurn({
        client,
        cwd: process.cwd(),
        sessionId: state.sessionId,
        surface,
        turn,
        workspace: refreshedWorkspace,
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
    } else {
      dispatch({
        type: "assistant/appended",
        message: "Online. What are we building?",
      });
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (composerMode === "edit_intent") {
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

  return (
    <Box
      flexDirection="column"
      width={stdoutWidth}
      minHeight={stdoutHeight}
    >
      <Header mode={mode} profile={state.resolvedProfile} surface={surface} />
      <StatusBar
        activeCapability={state.activeCapability}
        currentThought={state.thoughts[0]?.summary ?? null}
        scratchpad={state.scratchpad}
        status={state.status}
      />
      <Box flexGrow={1}>
        <Box flexDirection="column" width={mainWidth} flexGrow={1}>
          <Transcript
            activeCapability={state.activeCapability}
            entries={visibleTranscriptEntries}
            hasMoreAbove={transcriptStartIndex > 0}
            hasMoreBelow={transcriptEndIndex < totalTranscriptEntries}
            scrollOffset={clampedScrollOffset}
            streamingText={state.streamingText}
          />
        </Box>
        <Box flexDirection="column" width={sidebarWidth}>
          <ContextPanel
            changedFiles={state.changedFiles}
            currentObjective={state.currentObjective}
            lastPatchPreview={state.lastPatchPreview}
            pendingApproval={state.pendingApproval}
            pendingDraft={state.pendingDraft}
            pendingPlan={state.pendingPlan}
            scratchpad={state.scratchpad}
            verification={state.verification}
            workspace={state.workspace}
          />
          <ApprovalPanel approval={state.pendingApproval} />
          <ThinkingPanel collapsed={thinkingCollapsed} items={state.thoughts} />
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
          <ActivityFeed items={state.recentActivity} patchPreview={state.lastPatchPreview} />
        </Box>
      </Box>
      <CommandDrawer
        commands={commandMatches}
        selectedIndex={selectedCommandIndex}
        visible={commandDrawerVisible}
      />
      <Composer
        disabled={composerMode === "edit_intent"}
        initialQuery={initialQuery}
        onSubmit={handleSubmit}
        query={query}
        setQuery={setQuery}
      />
    </Box>
  );
}
