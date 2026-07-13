import type { ChatMessage } from "../runtime/types";
import type { PatchPreview } from "../tools/patch";
import {
  createApprovalRequest,
  createActivityEvent,
  createInitialSessionState,
  createThoughtFrame,
  createTranscriptEntry,
  type AgentMode,
  type ShellCommand,
  type SessionState,
} from "../agent/turn-state";
import type { WorkspaceSnapshot } from "./workspace";

export type SessionAction =
  | { type: "session/reset"; state: SessionState }
  | { type: "session/hydrated"; state: SessionState }
  | { type: "connection/opened" }
  | { type: "connection/closed" }
  | { type: "workspace/updated"; workspace: WorkspaceSnapshot }
  | { type: "patch/updated"; patch: PatchPreview; changedFile: string }
  | { type: "approval/approved"; requestId: string }
  | { type: "approval/rejected"; requestId: string }
  | { type: "shell/staged"; command: string; reason: string }
  | { type: "shell/cleared" }
  | {
      type: "turn/submitted";
      message: ChatMessage;
      objective: string;
      pendingPlan: string[];
      mode: AgentMode;
      resolvedProfile: string;
    }
  | { type: "local-command/submitted"; input: string }
  | { type: "turn/started" }
  | { type: "turn/token"; token: string }
  | { type: "turn/tokens"; count: number }
  | { type: "workstep/add"; message: string }
  | { type: "progress-message/add"; message: string }
  | { type: "tool/executed"; tool: string; summary: string; ok: boolean }
  | { type: "turn/response"; content: string }
  | { type: "turn/completed"; content?: string }
  | { type: "turn/failed"; error: string }
  | { type: "assistant/appended"; message: string }
  | { type: "thought/add"; kind: "goal" | "plan" | "inspect" | "capability" | "result" | "warning"; summary: string }
  | { type: "activity/add"; kind: "info" | "tool" | "status" | "error"; message: string }
  | { type: "travel/completed"; toPath: string; label: string; workspace: WorkspaceSnapshot | null }
  | { type: "transcript/cleared" }
  | { type: "conversation/replaced"; messages: import("../runtime/types").ChatMessage[] }
  | { type: "agent/activated"; agentId: string | null }
  | { type: "plan/created"; plan: import("../agent/turn-state").ActivePlan }
  | { type: "plan/started" }
  | { type: "plan/step-complete" }
  | { type: "plan/step-skipped" }
  | { type: "plan/stopped" }
  | { type: "session/title-set"; title: string };

function appendActivity(
  state: SessionState,
  kind: "info" | "tool" | "status" | "error",
  message: string,
): SessionState {
  return {
    ...state,
    recentActivity: [createActivityEvent(kind, message), ...state.recentActivity].slice(0, 8),
  };
}

function appendTranscript(
  state: SessionState,
  entry: ReturnType<typeof createTranscriptEntry>,
): SessionState {
  return {
    ...state,
    transcript: [...state.transcript, entry],
  };
}

function appendThought(
  state: SessionState,
  kind: "goal" | "plan" | "inspect" | "capability" | "result" | "warning",
  summary: string,
): SessionState {
  return {
    ...state,
    thoughts: [createThoughtFrame(kind, summary), ...state.thoughts].slice(0, 10),
  };
}

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "session/reset":
      return action.state;
    case "session/hydrated":
      return action.state;
    case "connection/opened":
      return { ...state, status: "CONNECTED" };
    case "connection/closed":
      return { ...state, status: "DISCONNECTED" };
    case "workspace/updated":
      return appendThought(
        appendActivity(
          {
            ...state,
            workspace: action.workspace,
          },
          "tool",
          `Workspace refreshed on ${action.workspace.branch ?? "unknown branch"}.`,
        ),
        "inspect",
        `Checked workspace on ${action.workspace.branch ?? "unknown branch"}.`,
      );
    case "patch/updated":
      return appendActivity(
        {
          ...state,
          lastPatchPreview: action.patch,
          changedFiles: Array.from(new Set([...state.changedFiles, action.changedFile])),
        },
        "tool",
        `Updated ${action.changedFile}.`,
      );
    case "approval/approved":
      return appendTranscript(
        appendThought(
          {
            ...state,
            pendingApproval:
              state.pendingApproval?.id === action.requestId ? null : state.pendingApproval,
          },
          "result",
          "Approved the pending action.",
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Approval Granted",
          body: "The pending action was approved and can proceed.",
          tone: "success",
        }),
      );
    case "approval/rejected":
      return appendTranscript(
        appendThought(
          {
            ...state,
            pendingApproval:
              state.pendingApproval?.id === action.requestId ? null : state.pendingApproval,
          },
          "warning",
          "Rejected the pending action.",
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Approval Rejected",
          body: "The pending action was rejected.",
          tone: "warning",
        }),
      );
    case "shell/staged":
      return appendTranscript(
        appendActivity(
          {
            ...state,
            pendingShell: { command: action.command, reason: action.reason },
            pendingApproval: createApprovalRequest({
              kind: "shell_command",
              title: "Run shell command",
              summary: action.command,
              commandHint: "1 no · 2 yes · 3 yes always",
            }),
          },
          "tool",
          `Shell pending: ${action.command.slice(0, 60)}`,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Shell: Awaiting Approval",
          body: `\`${action.command}\`\n\n${action.reason}`,
          tone: "warning",
        }),
      );
    case "shell/cleared":
      return { ...state, pendingShell: null, pendingApproval: null };
    case "turn/submitted":
      return appendTranscript(
        appendThought(
          appendActivity(
            {
              ...state,
              conversation: [...state.conversation, action.message],
              currentObjective: action.objective,
              pendingPlan: action.pendingPlan,
              mode: action.mode,
              resolvedProfile: action.resolvedProfile,
              lastError: null,
            },
            "info",
            `Updated objective: ${action.objective}`,
          ),
          "goal",
          action.objective,
        ),
        createTranscriptEntry({
          kind: "user",
          title: "User",
          body: String(action.message.content),
        }),
      );
    case "local-command/submitted":
      return appendTranscript(
        appendActivity(state, "info", `Ran local command: ${action.input.slice(0, 80)}`),
        createTranscriptEntry({
          kind: "user",
          title: "User",
          body: action.input,
        }),
      );
    case "turn/started":
      return appendThought(
        appendActivity(
          {
            ...state,
            status: "THINKING",
            streamingText: "",
            lastError: null,
            turnStartedAt: Date.now(),
            turnTokenCount: 0,
          },
          "status",
          "Assistant is working the turn.",
        ),
        "plan",
        "Planning the next step.",
      );
    case "turn/token":
      return {
        ...state,
        streamingText: state.streamingText + action.token,
        turnTokenCount: state.turnTokenCount + 1,
      };
    case "turn/tokens":
      return {
        ...state,
        turnTokenCount: state.turnTokenCount + action.count,
      };
    case "workstep/add": {
      const message = action.message.replace(/\s+/g, " ").trim();
      if (!message || state.transcript.at(-1)?.body === message) return state;
      return appendTranscript(
        appendActivity(state, "tool", message),
        createTranscriptEntry({
          kind: "tool",
          title: "Working",
          body: message,
          tone: "info",
        }),
      );
    }
    case "progress-message/add": {
      const message = action.message.trim();
      if (!message || state.transcript.at(-1)?.body === message) return state;
      return appendTranscript(
        appendActivity(state, "status", "Bay shared a progress update."),
        createTranscriptEntry({
          kind: "assistant",
          title: "Bay",
          body: message,
          tone: "info",
        }),
      );
    }
    case "tool/executed":
      return appendTranscript(
        appendThought(
          appendActivity(
            state,
            action.ok ? "tool" : "error",
            `Executed tool: ${action.tool}`,
          ),
          "inspect",
          `${action.tool.startsWith("local:") ? "local" : "tool"} capability ${action.tool} returned ${action.ok ? "usable" : "failed"} output.`,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: `Tool: ${action.tool}`,
          body: action.summary,
          tone: action.ok ? "info" : "error",
        }),
      );
    case "turn/response":
      return {
        ...state,
        streamingText: action.content,
      };
    case "turn/completed": {
      const trimmed = (action.content ?? state.streamingText).trim();
      const completedState = appendThought(
        appendActivity(
          {
            ...state,
            conversation: trimmed
              ? [
                  ...state.conversation,
                  {
                    role: "assistant" as const,
                    content: trimmed,
                  },
                ]
              : state.conversation,
            status: "READY",
            streamingText: "",
            turnStartedAt: null,
          },
          "status",
          "Turn complete.",
        ),
        "result",
        trimmed
          ? "Finished the turn and returned an answer."
          : "Finished the turn.",
      );

      if (!trimmed) {
        return completedState;
      }

      return appendTranscript(
        completedState,
        createTranscriptEntry({
          kind: "assistant",
          title: "Assistant",
          body: trimmed,
          tone: "info",
        }),
      );
    }
    case "assistant/appended":
      return appendTranscript(
        appendActivity(
          {
            ...state,
            status: "READY",
          },
          "info",
          "Local agent response added.",
        ),
        createTranscriptEntry({
          kind: "assistant",
          title: "Assistant",
          body: action.message,
          tone: "info",
        }),
      );
    case "turn/failed":
      return appendTranscript(
        appendThought(
          appendActivity(
            {
              ...state,
              status: "ERROR",
              streamingText: "",
              lastError: action.error,
              turnStartedAt: null,
              conversation: [
                ...state.conversation,
                {
                  role: "assistant",
                  content: "The provider failed before returning a usable response.",
                },
              ],
            },
            "error",
            action.error,
          ),
          "warning",
          action.error,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Turn Failed",
          body: action.error,
          tone: "error",
        }),
      );
    case "activity/add":
      return appendActivity(state, action.kind, action.message);
    case "thought/add":
      return appendThought(state, action.kind, action.summary);
    case "travel/completed": {
      const travelEntry = createTranscriptEntry({
        kind: "tool",
        title: `Hopped to ${action.label}`,
        body: `Now operating in ${action.toPath}`,
        tone: "info",
      });
      // Inject a system note into conversation so the provider knows the workspace changed.
      const systemNote: ChatMessage = {
        role: "system",
        content: `[LOCATION CHANGE] The switchbay has switched to a new workspace.\nPath: ${action.toPath}\nLabel: ${action.label}\nAll subsequent file operations and context apply to this new location.`,
      };
      return {
        ...state,
        workspace: action.workspace,
        transcript: [...state.transcript, travelEntry],
        conversation: [...state.conversation, systemNote],
      };
    }
    case "transcript/cleared":
      return {
        ...state,
        transcript: [],
        conversation: [],
        streamingText: "",
        pendingShell: null,
        pendingApproval: null,
        activePlan: null,
        thoughts: [],
        recentActivity: [],
        changedFiles: [],
        lastPatchPreview: null,
      };
    case "conversation/replaced":
      return { ...state, conversation: action.messages };
    case "agent/activated":
      return { ...state, activeAgentId: action.agentId };
    case "plan/created":
      return { ...state, activePlan: action.plan };
    case "plan/started":
      if (!state.activePlan) return state;
      return { ...state, activePlan: { ...state.activePlan, status: "running" } };
    case "plan/step-complete": {
      if (!state.activePlan) return state;
      const { activePlan } = state;
      const completedSteps = [...activePlan.completedSteps, activePlan.currentStep];
      const nextStep = activePlan.currentStep + 1;
      const done = nextStep >= activePlan.steps.length;
      return {
        ...state,
        activePlan: {
          ...activePlan,
          completedSteps,
          currentStep: nextStep,
          status: done ? "complete" : "awaiting_continue",
        },
      };
    }
    case "plan/step-skipped": {
      if (!state.activePlan) return state;
      const { activePlan } = state;
      const nextStep = activePlan.currentStep + 1;
      const done = nextStep >= activePlan.steps.length;
      return {
        ...state,
        activePlan: {
          ...activePlan,
          currentStep: nextStep,
          status: done ? "complete" : "awaiting_continue",
        },
      };
    }
    case "plan/stopped":
      return { ...state, activePlan: null };
    case "session/title-set":
      return { ...state, sessionTitle: action.title };
    default:
      return state;
  }
}

export function createSessionStore(input: {
  mode: AgentMode;
  profile: string;
  resolvedProfile: string;
  sessionId?: string;
  surface: string;
}) {
  return createInitialSessionState(input);
}
