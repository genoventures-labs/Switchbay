import { DEFAULTS } from "../config/defaults";
import type { OriMessage } from "../runtime/types";
import type { AgentMode } from "./turn-state";

export type ResolvedAgentPolicy = {
  mode: AgentMode;
  requestedProfile: string;
  runtimeProfile: string;
  modePrompt: OriMessage | null;
};

const MODE_PROMPTS: Record<AgentMode, string | null> = {
  build: null,
  design:
    "Operating mode is design. Prioritize architecture, tradeoffs, refactor safety, and crisp technical planning.",
  debug:
    "Operating mode is debug. Prioritize root cause isolation, verification steps, and the smallest reliable fix.",
};

export function normalizeMode(value?: string): AgentMode {
  if (value === "design" || value === "debug" || value === "build") {
    return value;
  }

  return DEFAULTS.mode;
}

export function resolveAgentPolicy(input: {
  mode?: string;
  profile: string;
}): ResolvedAgentPolicy {
  const mode = normalizeMode(input.mode);
  const modePrompt = MODE_PROMPTS[mode];

  return {
    mode,
    requestedProfile: input.profile,
    runtimeProfile: input.profile,
    modePrompt: modePrompt
      ? {
          role: "system",
          content: modePrompt,
        }
      : null,
  };
}
