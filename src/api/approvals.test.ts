import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApprovalRequest, createInitialSessionState } from "../agent/turn-state";
import { savePersistedSession } from "../session/persistence";
import { approve, cancelApproval, getApproval } from "./approvals";

let root = "";
afterEach(async () => { delete Bun.env.SWITCHBAY_SESSION_DIR; if (root) await rm(root, { recursive: true, force: true }); });

async function staged(command: string) {
  root = await mkdtemp(join(tmpdir(), "switchbay-approval-"));
  Bun.env.SWITCHBAY_SESSION_DIR = join(root, "sessions");
  const state = createInitialSessionState({ mode: "build", profile: "switchbay", resolvedProfile: "switchbay", surface: "dev", clientId: "test" });
  state.workspace = { cwd: root, repoRoot: null, branch: null, dirtyFiles: [], recentFiles: [], diff: null };
  state.pendingShell = { command, reason: "test" };
  state.pendingApproval = createApprovalRequest({ kind: "shell_command", title: "test", summary: "test", commandHint: command });
  await savePersistedSession(state);
  return state;
}

test("approval executes only the persisted command and clears it", async () => {
  const state = await staged("printf approved");
  expect((await getApproval(state.sessionId)).approval?.id).toBe(state.pendingApproval?.id);
  const result = await approve(state.sessionId, state.pendingApproval!.id);
  expect(result.result.stdout).toBe("approved");
  expect((await getApproval(state.sessionId)).approval).toBeNull();
});

test("cancel clears an approval without execution", async () => {
  const state = await staged("touch should-not-exist");
  await cancelApproval(state.sessionId, state.pendingApproval!.id);
  expect((await getApproval(state.sessionId)).approval).toBeNull();
  expect(await Bun.file(join(root, "should-not-exist")).exists()).toBe(false);
});
