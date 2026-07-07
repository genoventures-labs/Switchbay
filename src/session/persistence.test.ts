import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SessionState } from "../agent/turn-state";
import { createSessionStore, sessionReducer } from "./store";
import {
  listSessions,
  loadPersistedSession,
  purgeSessions,
  savePersistedSession,
} from "./persistence";

let previousSessionDir: string | undefined;
let sessionDir: string;

beforeEach(async () => {
  previousSessionDir = Bun.env.SWITCHBAY_SESSION_DIR;
  sessionDir = await mkdtemp(join(tmpdir(), "ori-code-sessions-"));
  Bun.env.SWITCHBAY_SESSION_DIR = sessionDir;
});

afterEach(() => {
  if (previousSessionDir === undefined) {
    delete Bun.env.SWITCHBAY_SESSION_DIR;
  } else {
    Bun.env.SWITCHBAY_SESSION_DIR = previousSessionDir;
  }
});

function createState(sessionId = "session-a"): SessionState {
  return createSessionStore({
    mode: "build",
    profile: "ori_code",
    resolvedProfile: "ori_code",
    sessionId,
    surface: "dev",
  });
}

test("savePersistedSession writes latest and session-specific files", async () => {
  const state = createState("persisted");

  await savePersistedSession(state);

  const latest = JSON.parse(await readFile(join(sessionDir, "session.json"), "utf-8"));
  const unique = JSON.parse(await readFile(join(sessionDir, "session-persisted.json"), "utf-8"));

  expect(latest.sessionId).toBe("persisted");
  expect(unique.sessionId).toBe("persisted");
  expect("scratchpad" in latest).toBe(false);
  expect("scratchpad" in unique).toBe(false);
});

test("loadPersistedSession returns normalized latest or specific state", async () => {
  const state = sessionReducer(createState("specific"), {
    type: "turn/submitted",
    message: { role: "user", content: "Build the thing" },
    objective: "Build the thing",
    pendingPlan: [],
    mode: "build",
    resolvedProfile: "ori_code",
  });

  await savePersistedSession(state);

  const latest = await loadPersistedSession();
  const specific = await loadPersistedSession("specific");

  expect(latest?.sessionId).toBe("specific");
  expect(specific?.conversation[0]?.content).toBe("Build the thing");
  expect(specific).not.toHaveProperty("scratchpad");
});

test("loadPersistedSession returns null for empty, malformed, or missing files", async () => {
  expect(await loadPersistedSession("missing")).toBeNull();

  await writeFile(join(sessionDir, "session-empty.json"), "", "utf-8");
  await writeFile(join(sessionDir, "session-bad.json"), "{ nope", "utf-8");

  expect(await loadPersistedSession("empty")).toBeNull();
  expect(await loadPersistedSession("bad")).toBeNull();
});

test("normalization preserves pending state and strips old error noise", async () => {
  const pendingApproval = {
    id: "approval-1",
    kind: "shell_command" as const,
    title: "Run shell command",
    summary: "git push",
    commandHint: "y to run · n to skip",
    createdAt: 123,
  };
  const pendingShell = { command: "git push origin main", reason: "Push" };

  await writeFile(
    join(sessionDir, "session-legacy.json"),
    JSON.stringify({
      sessionId: "legacy",
      mode: "build",
      requestedProfile: "ori_code",
      resolvedProfile: "ori_code",
      surface: "dev",
      pendingApproval,
      pendingShell,
      transcript: [
        { id: "ok", kind: "assistant", title: "ORI", body: "ok", timestamp: 1 },
        { id: "err", kind: "tool", title: "Turn Failed", body: "bad", tone: "error", timestamp: 2 },
      ],
      recentActivity: [
        { id: "a", kind: "info", message: "ok", timestamp: 1 },
        { id: "b", kind: "error", message: "bad", timestamp: 2 },
      ],
      scratchpad: { status: "active", task: "old" },
    }),
    "utf-8",
  );

  const loaded = await loadPersistedSession("legacy");

  expect(loaded?.pendingApproval).toEqual(pendingApproval);
  expect(loaded?.pendingShell).toEqual(pendingShell);
  expect(loaded?.transcript.some((entry) => entry.tone === "error")).toBe(false);
  expect(loaded?.recentActivity.some((event) => event.kind === "error")).toBe(false);
  expect(loaded).not.toHaveProperty("scratchpad");
});

test("listSessions sorts newest first and derives titles", async () => {
  await writeFile(
    join(sessionDir, "session-old.json"),
    JSON.stringify({
      sessionId: "old",
      conversation: [{ role: "user", content: "Older useful request" }],
      updatedAt: 100,
    }),
    "utf-8",
  );
  await writeFile(
    join(sessionDir, "session-new.json"),
    JSON.stringify({
      sessionId: "new",
      sessionTitle: "Pinned title",
      updatedAt: 200,
    }),
    "utf-8",
  );
  await writeFile(join(sessionDir, "session-bad.json"), "{ nope", "utf-8");

  const sessions = await listSessions();

  expect(sessions.map((session) => session.id)).toEqual(["new", "old"]);
  expect(sessions[0]?.title).toBe("Pinned title");
  expect(sessions[1]?.title).toBe("Older useful request");
});

test("purgeSessions removes old session json files", async () => {
  await writeFile(join(sessionDir, "session-old.json"), "{}", "utf-8");
  await writeFile(join(sessionDir, "session-new.json"), "{}", "utf-8");

  const oldPath = join(sessionDir, "session-old.json");
  const veryOld = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await fsutimes(oldPath, veryOld, veryOld);

  const purged = await purgeSessions(24 * 60 * 60 * 1000);

  expect(purged).toBe(1);
  await expect(stat(join(sessionDir, "session-new.json"))).resolves.toBeTruthy();
  await expect(stat(oldPath)).rejects.toThrow();
});

async function fsutimes(filePath: string, atime: Date, mtime: Date): Promise<void> {
  const { utimes } = await import("node:fs/promises");
  await utimes(filePath, atime, mtime);
}
