import path from "node:path";
import {
  createInitialSessionState,
  createThoughtFrame,
  type SessionState,
} from "../agent/turn-state";

const SESSION_DIR = path.join(process.cwd(), ".ori");
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

  return {
    ...fallback,
    ...parsed,
    sessionId: parsed.sessionId ?? fallback.sessionId,
    conversation: parsed.conversation ?? fallback.conversation,
    transcript: parsed.transcript ?? fallback.transcript,
    recentActivity: parsed.recentActivity ?? fallback.recentActivity,
    pendingPlan: parsed.pendingPlan ?? fallback.pendingPlan,
    changedFiles: parsed.changedFiles ?? fallback.changedFiles,
    thoughts:
      parsed.thoughts && parsed.thoughts.length > 0
        ? parsed.thoughts
        : [createThoughtFrame("goal", "Restored session state.")],
    pendingDraft: parsed.pendingDraft ?? null,
    pendingApproval: parsed.pendingApproval ?? null,
    scratchpad: null,
  };
}
