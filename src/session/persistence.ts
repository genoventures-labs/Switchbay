import path from "node:path";
import fs from "node:fs/promises";
import {
  createInitialSessionState,
  createThoughtFrame,
  type SessionState,
} from "../agent/turn-state";

function getSessionPaths() {
  const sessionDir = Bun.env.SWITCHBAY_SESSION_DIR ??
    path.join(
      Bun.env.HOME ?? process.env.HOME ?? process.cwd(),
      ".switchbay",
      "sessions",
    );

  return {
    sessionDir,
    sessionPath: path.join(sessionDir, "session.json"),
  };
}

export async function loadPersistedSession(id?: string): Promise<SessionState | null> {
  const { sessionDir, sessionPath } = getSessionPaths();
  const targetPath = id ? path.join(sessionDir, `session-${id}.json`) : sessionPath;
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
    const { sessionDir, sessionPath } = getSessionPaths();
    await fs.mkdir(sessionDir, { recursive: true });
    
    const serializableState: SessionState = {
      ...state,
      updatedAt: Date.now(),
    };
    
    const content = JSON.stringify(serializableState, null, 2);
    
    // Always update the main session.json for quick --resume
    await Bun.write(sessionPath, content);
    
    // Also save a unique record
    const uniquePath = path.join(sessionDir, `session-${state.sessionId}.json`);
    await Bun.write(uniquePath, content);
  } catch (e) {
    // Silent fail on save errors
  }
}

export async function listSessions(): Promise<{ id: string; title: string; updatedAt: number }[]> {
  const sessions: { id: string; title: string; updatedAt: number }[] = [];
  
  try {
    const { sessionDir } = getSessionPaths();
    const entries = await fs.readdir(sessionDir);
    const sessionFiles = entries.filter(e => e.startsWith("session-") && e.endsWith(".json"));
    
    for (const fname of sessionFiles) {
      try {
        const p = path.join(sessionDir, fname);
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
    const { sessionDir } = getSessionPaths();
    const entries = await fs.readdir(sessionDir);
    for (const fname of entries) {
      if (!fname.endsWith(".json")) continue;
      
      const p = path.join(sessionDir, fname);
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
    profile: parsed.requestedProfile ?? "switchbay",
    resolvedProfile: parsed.resolvedProfile ?? parsed.requestedProfile ?? "switchbay",
    sessionId: parsed.sessionId,
    surface: parsed.surface ?? "dev",
  });

  const cleanTranscript = (parsed.transcript ?? fallback.transcript).filter(
    (entry) => !(entry.kind === "tool" && entry.tone === "error"),
  );
  const cleanActivity = (parsed.recentActivity ?? fallback.recentActivity).filter(
    (event) => event.kind !== "error",
  );

  const normalized = {
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
    pendingApproval: parsed.pendingApproval ?? null,
    updatedAt: parsed.updatedAt ?? Date.now(),
  };

  delete (normalized as Record<string, unknown>).scratchpad;
  delete (normalized as Record<string, unknown>).activeBundleIds;

  return normalized;
}
