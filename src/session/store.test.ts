import { expect, test } from "bun:test";
import type { ActivePlan } from "../agent/turn-state";
import { createSessionStore, sessionReducer } from "./store";

function createState() {
  return createSessionStore({
    mode: "build",
    profile: "switchbay",
    resolvedProfile: "switchbay",
    sessionId: "test-session",
    surface: "dev",
  });
}

test("approval actions clear only the matching approval", () => {
  const staged = sessionReducer(createState(), {
    type: "shell/staged",
    command: "git push origin main",
    reason: "Push to remote",
  });
  const approvalId = staged.pendingApproval!.id;

  const wrong = sessionReducer(staged, { type: "approval/approved", requestId: "wrong-id" });
  expect(wrong.pendingApproval?.id).toBe(approvalId);

  const approved = sessionReducer(staged, { type: "approval/approved", requestId: approvalId });
  expect(approved.pendingApproval).toBeNull();
  expect(approved.transcript.at(-1)?.title).toBe("Approval Granted");

  const rejected = sessionReducer(staged, { type: "approval/rejected", requestId: approvalId });
  expect(rejected.pendingApproval).toBeNull();
  expect(rejected.transcript.at(-1)?.title).toBe("Approval Rejected");
});

test("shell/staged and shell/cleared manage shell approval state", () => {
  const staged = sessionReducer(createState(), {
    type: "shell/staged",
    command: "git push origin main",
    reason: "Push to remote",
  });

  expect(staged.pendingShell?.command).toBe("git push origin main");
  expect(staged.pendingApproval?.kind).toBe("shell_command");
  expect(staged.transcript.at(-1)?.title).toBe("Shell: Awaiting Approval");

  const cleared = sessionReducer(staged, { type: "shell/cleared" });
  expect(cleared.pendingShell).toBeNull();
  expect(cleared.pendingApproval).toBeNull();
});

test("turn/completed records assistant text and clears streaming state", () => {
  const started = sessionReducer(createState(), { type: "turn/started" });
  const streaming = sessionReducer(started, { type: "turn/token", token: "Hello" });
  const completed = sessionReducer(streaming, { type: "turn/completed" });

  expect(completed.status).toBe("READY");
  expect(completed.streamingText).toBe("");
  expect(completed.conversation.at(-1)).toEqual({ role: "assistant", content: "Hello" });
  expect(completed.transcript.at(-1)?.body).toBe("Hello");
});

test("local command entries do not mutate model conversation", () => {
  const prior = sessionReducer(createState(), {
    type: "turn/submitted",
    message: { role: "user", content: "hello bay" },
    objective: "Answer the user.",
    pendingPlan: [],
    mode: "build",
    resolvedProfile: "switchbay",
  });
  const completed = sessionReducer(prior, { type: "turn/completed", content: "hello" });
  const local = sessionReducer(completed, { type: "local-command/submitted", input: "/workspace" });

  expect(local.transcript.map((entry) => entry.body)).toContain("/workspace");
  expect(local.conversation).toEqual(completed.conversation);
  expect(local.currentObjective).toBe(completed.currentObjective);
});

test("plan step progression reaches awaiting_continue then complete", () => {
  const plan: ActivePlan = {
    id: "plan-1",
    goal: "tighten dashboard",
    steps: ["inspect", "fix"],
    currentStep: 0,
    completedSteps: [],
    status: "running",
  };

  const created = sessionReducer(createState(), { type: "plan/created", plan });
  const first = sessionReducer(created, { type: "plan/step-complete" });
  expect(first.activePlan?.completedSteps).toEqual([0]);
  expect(first.activePlan?.currentStep).toBe(1);
  expect(first.activePlan?.status).toBe("awaiting_continue");

  const running = sessionReducer(first, { type: "plan/started" });
  const done = sessionReducer(running, { type: "plan/step-complete" });
  expect(done.activePlan?.completedSteps).toEqual([0, 1]);
  expect(done.activePlan?.status).toBe("complete");
});
