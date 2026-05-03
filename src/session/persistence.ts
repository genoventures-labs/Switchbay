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
    const text = await file.text();
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as Partial<SessionState>;
    return normalizeSessionState(parsed);
  } catch (e) {
    return null;
  }
}

export async function savePersistedSession(state: SessionState): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
    
    const serializableState: SessionState = {
      ...state,
      scratchpad: null,
      updatedAt: Date.now(),
    };
    
    const content = JSON.stringify(serializableState, null, 2);
    
    // Always update the main session.json for quick --resume
    await Bun.write(SESSION_PATH, content);
    
    // Also save a unique record
    const uniquePath = path.join(SESSION_DIR, `session-${state.sessionId}.json`);
    await Bun.write(uniquePath, content);
  } catch (e) {
    // Silent fail on save errors
  }
}

export async function listSessions(): Promise<{ id: string; title: string; updatedAt: number }[]> {
  const sessions: { id: string; title: string; updatedAt: number }[] = [];
  
  try {
    const entries = await fs.readdir(SESSION_DIR);
    const sessionFiles = entries.filter(e => e.startsWith("session-") && e.endsWith(".json"));
    
    for (const fname of sessionFiles) {
      try {
        const p = path.join(SESSION_DIR, fname);
        const file = Bun.file(p);
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Use stored sessionTitle if available, else derive from first real user message
        let title: string = data.sessionTitle ?? "";
        if (!title) {
          const firstUserMsg = data.conversation?.find((m: any) => m.role === "user" && !String(m.content).startsWith("/"));
          if (firstUserMsg) {
            const content = String(firstUserMsg.content);
            title = content.slice(0, 60) + (content.length > 60 ? "…" : "");
          } else {
            title = "Untitled Session";
          }
        }
        
        const id = fname.replace("session-", "").replace(".json", "");
        
        sessions.push({
          id,
          title,
          updatedAt: data.updatedAt ?? (await fs.stat(p)).mtimeMs,
        });
      } catch {
        // Skip malformed
      }
    }
  } catch {
    // Dir missing
  }
  
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function purgeSessions(olderThanMs: number): Promise<number> {
  let count = 0;
  const now = Date.now();
  
  try {
    const entries = await fs.readdir(SESSION_DIR);
    for (const fname of entries) {
      if (!fname.endsWith(".json")) continue;
      
      const p = path.join(SESSION_DIR, fname);
      try {
        const stats = await fs.stat(p);
        if (now - stats.mtimeMs > olderThanMs) {
          await fs.unlink(p);
          count++;
        }
      } catch {}
    }
  } catch {}
  
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
    activeBundleIds: parsed.activeBundleIds ?? [],
  };
}
