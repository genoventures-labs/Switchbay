import { createTranscriptEntry } from "../agent/turn-state";
import { loadPersistedSession, savePersistedSession } from "../session/persistence";
import { runShellString } from "../tools/shell";

export async function getApproval(sessionId: string) {
  const state = await requiredSession(sessionId);
  return { sessionId, approval: state.pendingApproval };
}

export async function approve(sessionId: string, approvalId: string) {
  const state = await requiredSession(sessionId);
  requireApproval(state, approvalId);
  if (!state.pendingShell) throw coded("No pending command", "no_pending_approval");
  const pending = state.pendingShell;
  const cwd = state.workspace?.cwd;
  if (!cwd) throw coded("Session has no workspace", "session_scope_mismatch");
  const result = await runShellString(pending.command, cwd);
  state.pendingShell = null;
  state.pendingApproval = null;
  state.transcript.push(createTranscriptEntry({ kind: "tool", title: result.ok ? "Approved command completed" : "Approved command failed", body: result.stdout || result.stderr, tone: result.ok ? "success" : "error" }));
  await savePersistedSession(state);
  return { sessionId, approved: true, result };
}

export async function cancelApproval(sessionId: string, approvalId: string) {
  const state = await requiredSession(sessionId);
  requireApproval(state, approvalId);
  state.pendingShell = null;
  state.pendingApproval = null;
  await savePersistedSession(state);
  return { sessionId, cancelled: true };
}

function validId(id: string) { return /^[A-Za-z0-9_-]{1,100}$/.test(id); }
async function requiredSession(id: string) { if (!validId(id)) throw coded("Invalid session id", "bad_request"); const state = await loadPersistedSession(id); if (!state) throw coded("Session not found", "session_not_found"); return state; }
function requireApproval(state: Awaited<ReturnType<typeof requiredSession>>, id: string) { if (!state.pendingApproval) throw coded("No pending approval", "no_pending_approval"); if (state.pendingApproval.id !== id) throw coded("Approval id does not match", "approval_mismatch"); }
function coded(message: string, code: string) { return Object.assign(new Error(message), { code }); }
