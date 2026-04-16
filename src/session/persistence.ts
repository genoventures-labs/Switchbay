import path from "node:path";
import {
  createInitialSessionState,
  createThoughtFrame,
  type SessionState,
} from "../agent/turn-state";

const SESSION_DIR = path.join(
  Bun.env.HOME ?? process.env.HOME ?? process.cwd(),
  ".ori",
  "sessions",
);
const SESSION_PATH = path.join(SESSION_DIR, "session.json");

export async function loadPersistedSession(): Promise<SessionState | null> {
  const file = Bun.file(SESSION_PATH);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const parsed = JSON.parse(await file.text()) as Partial<SessionState>;
    return normalizeSessionState(parsed);
  } catch {
    return null;
  }
}

export async function savePersistedSession(state: SessionState): Promise<void> {
  await Bun.$`mkdir -p ${SESSION_DIR}`.quiet();
  const serializableState: SessionState = {
    ...state,
    scratchpad: null,
  };
  await Bun.write(SESSION_PATH, JSON.stringify(serializableState, null, 2));
}

function normalizeSessionState(parsed: Partial<SessionState>): SessionState {
  const fallback = createInitialSessionState({
    mode: parsed.mode ?? "build",
    profile: parsed.requestedProfile ?? "ori_code",
    resolvedProfile: parsed.resolvedProfile ?? parsed.requestedProfile ?? "ori_code",
    sessionId: parsed.sessionId,
    surface: parsed.surface ?? "dev",
  });

  const cleanTranscript = (parsed.transcript ?? fallback.transcript).filter(
    (entry) => !(entry.kind === "tool" && entry.tone === "error"),
  );
  const cleanActivity = (parsed.recentActivity ?? fallback.recentActivity).filter(
    (event) => event.kind !== "error",
  );

  return {
    ...fallback,
    ...parsed,
    sessionId: parsed.sessionId ?? fallback.sessionId,
    conversation: parsed.conversation ?? fallback.conversation,
    transcript: cleanTranscript,
    recentActivity: cleanActivity,
    pendingPlan: parsed.pendingPlan ?? fallback.pendingPlan,
    changedFiles: parsed.changedFiles ?? fallback.changedFiles,
    thoughts:
      parsed.thoughts && parsed.thoughts.length > 0
        ? parsed.thoughts
        : [createThoughtFrame("goal", "Restored session state.")],
    pendingDraft: parsed.pendingDraft ?? null,
    pendingPlanDraft: parsed.pendingPlanDraft ?? null,
    pendingApproval: parsed.pendingApproval ?? null,
    scratchpad: null,
  };
}
