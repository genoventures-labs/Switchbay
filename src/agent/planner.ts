import type { AgentMode } from "./turn-state";

const MODE_PLANS: Record<AgentMode, string[]> = {
  build: [
    "Inspect the relevant code and repo context.",
    "Make the smallest high-confidence change.",
    "Verify the result before wrapping up.",
  ],
  design: [
    "Clarify the architecture or refactor target.",
    "Compare tradeoffs and choose the cleanest path.",
    "Translate the decision into an actionable implementation plan.",
  ],
  debug: [
    "Reproduce or isolate the failure signal.",
    "Identify the most likely root cause.",
    "Validate the fix with a targeted verification step.",
  ],
};

export function deriveObjective(input: string, previousObjective: string | null): string {
  const nextObjective = input.trim();
  return nextObjective || previousObjective || "Continue the current task.";
}

export function draftPlan(mode: AgentMode): string[] {
  return MODE_PLANS[mode];
}
