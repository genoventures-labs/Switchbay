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

export async function loadPersistedSession(id?: string): Promise<SessionState | null> {
  const targetPath = id ? path.join(SESSION_DIR, `session-${id}.json`) : SESSION_PATH;
  const file = Bun.file(targetPath);

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
    updatedAt: Date.now(),
    scratchpad: null,
  };
  
  // Always update the main session.json for quick --resume
  await Bun.write(SESSION_PATH, JSON.stringify(serializableState, null, 2));
  
  // Also save a unique record
  const uniquePath = path.join(SESSION_DIR, `session-${state.sessionId}.json`);
  await Bun.write(uniquePath, JSON.stringify(serializableState, null, 2));
}

export async function listSessions(): Promise<{ id: string; title: string; updatedAt: number }[]> {
  const sessions: { id: string; title: string; updatedAt: number }[] = [];
  
  try {
    const files = await Bun.$`ls ${SESSION_DIR}/session-*.json`.text();
    const paths = files.trim().split("\n").filter(Boolean);
    
    for (const p of paths) {
      try {
        const file = Bun.file(p);
        const text = await file.text();
        const data = JSON.parse(text);
        
        let title = "Untitled Session";
        const firstUserMsg = data.conversation?.find((m: any) => m.role === "user");
        if (firstUserMsg) {
          title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? "..." : "");
        }
        
        const id = path.basename(p, ".json").replace("session-", "");
        
        sessions.push({
          id,
          title,
          updatedAt: data.updatedAt ?? Date.now(),
        });
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // No sessions found or directory doesn't exist
  }
  
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
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
