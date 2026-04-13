import type { OriMessage, ScratchpadState } from "../runtime/types";
import type { PatchPreview } from "../tools/patch";
import type { VerificationSummary } from "../tools/verify";
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

export type DraftEdit = {
  after: string;
  before: string;
  patch: PatchPreview;
  reason: string;
  targetPath: string;
};

export type ApprovalKind = "draft_edit";

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
  conversation: OriMessage[];
  transcript: TranscriptEntry[];
  status: SessionStatus;
  activeCapability: string | null;
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
  verification: VerificationSummary | null;
  changedFiles: string[];
  lastPatchPreview: PatchPreview | null;
  pendingDraft: DraftEdit | null;
  pendingApproval: ApprovalRequest | null;
  thoughts: ThoughtFrame[];
  scratchpad: ScratchpadState | null;
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
}): SessionState {
  return {
    sessionId: input.sessionId ?? crypto.randomUUID(),
    conversation: [],
    transcript: [
      createTranscriptEntry({
        kind: "tool",
        title: "Session Started",
        body: `Booted ORI Code in ${input.mode} mode on ${input.surface}.`,
        tone: "info",
      }),
    ],
    status: "CONNECTING",
    activeCapability: null,
    streamingText: "",
    currentObjective: null,
    pendingPlan: [],
    recentActivity: [
      createActivityEvent(
        "info",
        `Booted ORI Code in ${input.mode} mode on ${input.surface}.`,
      ),
    ],
    mode: input.mode,
    requestedProfile: input.profile,
    resolvedProfile: input.resolvedProfile,
    surface: input.surface,
    lastError: null,
    workspace: null,
    verification: null,
    changedFiles: [],
    lastPatchPreview: null,
    pendingDraft: null,
    pendingApproval: null,
    thoughts: [
      createThoughtFrame("goal", `Session booted in ${input.mode} mode.`),
    ],
    scratchpad: null,
  };
}
