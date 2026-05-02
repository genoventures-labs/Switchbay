import type { OriMessage } from "../runtime/types";
import type { PatchPreview } from "../tools/patch";
import type { VerificationSummary } from "../tools/verify";
import {
  createApprovalRequest,
  createActivityEvent,
  createInitialSessionState,
  createThoughtFrame,
  createTranscriptEntry,
  type DraftEdit,
  type AgentMode,
  type PlanDraft,
  type ShellCommand,
  type SessionState,
} from "../agent/turn-state";
import type { WorkspaceSnapshot } from "./workspace";

export type SessionAction =
  | { type: "session/reset"; state: SessionState }
  | { type: "session/hydrated"; state: SessionState }
  | { type: "scratchpad/updated"; scratchpad: SessionState["scratchpad"] }
  | { type: "connection/opened" }
  | { type: "connection/closed" }
  | { type: "workspace/updated"; workspace: WorkspaceSnapshot }
  | { type: "patch/updated"; patch: PatchPreview; changedFile: string }
  | { type: "draft/staged"; draft: DraftEdit }
  | { type: "plan/staged"; plan: PlanDraft }
  | { type: "approval/approved"; requestId: string }
  | { type: "approval/rejected"; requestId: string }
  | { type: "draft/cleared" }
  | { type: "plan/cleared" }
  | { type: "shell/staged"; command: string; reason: string }
  | { type: "shell/cleared" }
  | { type: "verification/updated"; verification: VerificationSummary }
  | {
      type: "turn/submitted";
      message: OriMessage;
      objective: string;
      pendingPlan: string[];
      mode: AgentMode;
      resolvedProfile: string;
    }
  | { type: "turn/started" }
  | { type: "turn/capability"; capability: string | null }
  | { type: "turn/token"; token: string }
  | { type: "turn/tokens"; count: number }
  | { type: "tool/executed"; tool: string; summary: string; ok: boolean }
  | { type: "turn/response"; content: string }
  | { type: "turn/completed"; content?: string }
  | { type: "turn/failed"; error: string }
  | { type: "assistant/appended"; message: string }
  | { type: "thought/add"; kind: "goal" | "plan" | "inspect" | "capability" | "result" | "warning"; summary: string }
  | { type: "activity/add"; kind: "info" | "tool" | "status" | "error"; message: string }
  | { type: "travel/completed"; toPath: string; label: string; workspace: WorkspaceSnapshot | null }
  | { type: "transcript/cleared" }
  | { type: "conversation/replaced"; messages: import("../runtime/types").OriMessage[] }
  | { type: "agent/activated"; agentId: string | null }
  | { type: "plan/created"; plan: import("../agent/turn-state").ActivePlan }
  | { type: "plan/started" }
  | { type: "plan/step-complete" }
  | { type: "plan/step-skipped" }
  | { type: "plan/stopped" };

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
    case "scratchpad/updated":
      return appendActivity(
        {
          ...state,
          scratchpad: action.scratchpad,
        },
        "info",
        action.scratchpad?.task
          ? `Scratchpad ${action.scratchpad.status}: ${action.scratchpad.task}`
          : "Scratchpad cleared.",
      );
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
    case "draft/staged":
      return appendTranscript(
        appendThought(
          appendActivity(
            {
              ...state,
              pendingDraft: action.draft,
              pendingApproval: createApprovalRequest({
                kind: "draft_edit",
                title: `Approve edit for ${action.draft.targetPath}`,
                summary: action.draft.reason,
                commandHint: "/apply or /cancel",
              }),
              lastPatchPreview: action.draft.patch,
            },
            "tool",
            `Drafted edit for ${action.draft.targetPath}.`,
          ),
          "result",
          `Prepared a patch for ${action.draft.targetPath}.`,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Draft Patch Ready",
          body: `${action.draft.reason}\n\nTarget: ${action.draft.targetPath}`,
          tone: "warning",
        }),
      );
    case "plan/staged":
      return appendTranscript(
        appendThought(
          appendActivity(
            {
              ...state,
              pendingPlanDraft: action.plan,
              pendingApproval: createApprovalRequest({
                kind: "execution_plan",
                title: `Approve execution plan: ${action.plan.title}`,
                summary: "Review the proposed implementation plan. Approve to start building.",
                commandHint: "/apply or /cancel",
              }),
            },
            "tool",
            `Drafted execution plan: ${action.plan.title}.`,
          ),
          "plan",
          `Prepared an execution plan for ${action.plan.title}.`,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Execution Plan Ready",
          body: action.plan.content,
          tone: "warning",
        }),
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
    case "draft/cleared":
      return appendTranscript(
        {
          ...state,
          pendingDraft: null,
          pendingApproval: null,
        },
        createTranscriptEntry({
          kind: "tool",
          title: "Draft Cleared",
          body: "The pending draft was canceled.",
          tone: "info",
        }),
      );
    case "plan/cleared":
      return appendTranscript(
        {
          ...state,
          pendingPlanDraft: null,
          pendingApproval: null,
        },
        createTranscriptEntry({
          kind: "tool",
          title: "Plan Cleared",
          body: "The pending execution plan was canceled.",
          tone: "info",
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
              commandHint: "/apply to run · /cancel to skip",
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
    case "verification/updated":
      return appendTranscript(
        appendActivity(
          {
            ...state,
            verification: action.verification,
          },
          action.verification.ok ? "status" : "error",
          action.verification.summary,
        ),
        createTranscriptEntry({
          kind: "tool",
          title: "Verification",
          body: `${action.verification.summary}\n\nCommand: ${action.verification.command}`,
          tone: action.verification.ok ? "success" : "error",
        }),
      );
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
          body: action.message.content,
        }),
      );
    case "turn/started":
      return appendThought(
        appendActivity(
          {
            ...state,
            status: "THINKING",
            streamingText: "",
            activeCapability: null,
            lastError: null,
            turnStartedAt: Date.now(),
            turnTokenCount: 0,
          },
          "status",
          "ORI is working the turn.",
        ),
        "plan",
        "Planning the next step.",
      );
    case "turn/capability":
      return appendThought(
        appendActivity(
          {
            ...state,
            activeCapability: action.capability,
          },
          "tool",
          action.capability
            ? `Agent capability active: ${action.capability}`
            : "Agent capability cleared.",
        ),
        "capability",
        action.capability
          ? action.capability.startsWith("local:")
            ? `local:${action.capability.slice(6)} inspection in progress.`
            : action.capability.startsWith("ori:")
              ? `ori:${action.capability.slice(4)} reasoning helper in progress.`
              : `Using ${action.capability}.`
          : "Capability cleared.",
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
    case "tool/executed":
      return appendTranscript(
        appendThought(
          appendActivity(
            state,
            action.ok ? "tool" : "error",
            `Executed tool: ${action.tool}`,
          ),
          "inspect",
          `${action.tool.startsWith("local:") ? "local" : "ori"} capability ${action.tool} returned ${action.ok ? "usable" : "failed"} output.`,
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
            activeCapability: null,
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
          title: "ORI",
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
          title: "ORI",
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
              activeCapability: null,
              streamingText: "",
              lastError: action.error,
              turnStartedAt: null,
              conversation: [
                ...state.conversation,
                {
                  role: "assistant",
                  content: "Sorry honey, backbone's acting up.",
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
      // Inject a system note into conversation so ORI knows the workspace changed
      const systemNote: OriMessage = {
        role: "system",
        content: `[LOCATION CHANGE] ORI has traveled to a new workspace.\nPath: ${action.toPath}\nLabel: ${action.label}\nAll subsequent file operations and context apply to this new location.`,
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
        pendingDraft: null,
        pendingPlanDraft: null,
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
