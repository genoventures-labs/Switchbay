import type { ChatMessage } from "../runtime/types";
import type { PatchPreview } from "../tools/patch";
import type { WorkspaceSnapshot } from "../session/workspace";

export type AgentMode = "build" | "design" | "debug";

export type SessionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "READY"
  | "THINKING"
  | "ERROR"
  | "DISCONNECTED";

export type ActivityEvent = {
  id: string;
  kind: "info" | "tool" | "status" | "error";
  message: string;
  timestamp: number;
};

export type ThoughtFrame = {
  id: string;
  kind: "goal" | "plan" | "inspect" | "capability" | "result" | "warning";
  summary: string;
  timestamp: number;
};

export type TranscriptEntry = {
  id: string;
  kind: "user" | "assistant" | "tool";
  title: string;
  body: string;
  timestamp: number;
  tone?: "info" | "success" | "warning" | "error";
};

export type ShellCommand = {
  command: string;
  reason: string;
};

export type ApprovalKind = "execution_plan" | "shell_command";

export type PlanStatus =
  | "pending_approval"  // generated, waiting for user to say y
  | "running"           // step currently executing
  | "awaiting_continue" // step done, waiting for y/skip/stop
  | "complete"
  | "stopped";

export type ActivePlan = {
  id: string;
  goal: string;
  steps: string[];
  currentStep: number;
  completedSteps: number[];
  status: PlanStatus;
};

export type ApprovalRequest = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  commandHint: string;
  createdAt: number;
};

export type SessionState = {
  sessionId: string;
  clientId?: string;
  conversation: ChatMessage[];
  transcript: TranscriptEntry[];
  status: SessionStatus;
  streamingText: string;
  currentObjective: string | null;
  pendingPlan: string[];
  recentActivity: ActivityEvent[];
  mode: AgentMode;
  requestedProfile: string;
  resolvedProfile: string;
  surface: string;
  lastError: string | null;
  workspace: WorkspaceSnapshot | null;
  changedFiles: string[];
  lastPatchPreview: PatchPreview | null;
  pendingShell: ShellCommand | null;
  pendingApproval: ApprovalRequest | null;
  thoughts: ThoughtFrame[];
  updatedAt: number;
  activeAgentId: string | null;
  activePlan: ActivePlan | null;
  sessionTitle: string | null;
  turnStartedAt: number | null;
  turnTokenCount: number;
  activeSpeaker: string;
};

export function createActivityEvent(
  kind: ActivityEvent["kind"],
  message: string,
): ActivityEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    message,
    timestamp: Date.now(),
  };
}

export function createTranscriptEntry(
  input: Omit<TranscriptEntry, "id" | "timestamp">,
): TranscriptEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...input,
  };
}

export function createThoughtFrame(
  kind: ThoughtFrame["kind"],
  summary: string,
): ThoughtFrame {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    summary,
    timestamp: Date.now(),
  };
}

export function createApprovalRequest(input: {
  kind: ApprovalKind;
  title: string;
  summary: string;
  commandHint: string;
}): ApprovalRequest {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  };
}

export function createInitialSessionState(input: {
  mode: AgentMode;
  profile: string;
  resolvedProfile: string;
  sessionId?: string;
  surface: string;
  clientId?: string;
}): SessionState {
  return {
    sessionId: input.sessionId ?? crypto.randomUUID(),
    clientId: input.clientId,
    conversation: [],
    transcript: [
      createTranscriptEntry({
        kind: "tool",
        title: "Session Started",
        body: "",
        tone: "info",
      }),
    ],
    status: "CONNECTING",
    streamingText: "",
    currentObjective: null,
    pendingPlan: [],
    recentActivity: [
      createActivityEvent(
        "info",
        `Booted coding switchbay in ${input.mode} mode on ${input.surface}.`,
      ),
    ],
    mode: input.mode,
    requestedProfile: input.profile,
    resolvedProfile: input.resolvedProfile,
    surface: input.surface,
    updatedAt: Date.now(),
    activeAgentId: null,
    activePlan: null,
    sessionTitle: null,
    lastError: null,
    workspace: null,
    changedFiles: [],
    lastPatchPreview: null,
    pendingShell: null,
    pendingApproval: null,
    thoughts: [
      createThoughtFrame("goal", `Session booted in ${input.mode} mode.`),
    ],
    turnStartedAt: null,
    turnTokenCount: 0,
    activeSpeaker: "Model",
  };
}
