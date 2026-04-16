import path from "node:path";
import fs from "node:fs/promises";
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
    scratchpad: null,
    updatedAt: Date.now(),
  };
  
  await Bun.write(SESSION_PATH, JSON.stringify(serializableState, null, 2));
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
          updatedAt: data.updatedAt ?? (await fs.stat(p)).mtimeMs,
        });
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // No sessions found
  }
  
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function purgeSessions(olderThanMs: number): Promise<number> {
  let count = 0;
  const now = Date.now();
  
  try {
    const files = await Bun.$`ls ${SESSION_DIR}/session-*.json`.text();
    const paths = files.trim().split("\n").filter(Boolean);
    
    for (const p of paths) {
      try {
        const stats = await fs.stat(p);
        if (now - stats.mtimeMs > olderThanMs) {
          await fs.unlink(p);
          count++;
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
    
    // Also check the main session.json
    try {
      const stats = await fs.stat(SESSION_PATH);
      if (now - stats.mtimeMs > olderThanMs) {
        await fs.unlink(SESSION_PATH);
      }
    } catch {}
    
  } catch {
    // Directory might not exist
  }
  
  return count;
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
    updatedAt: parsed.updatedAt ?? Date.now(),
  };
}
