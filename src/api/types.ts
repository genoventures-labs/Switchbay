import type { RuntimeLane } from "../config/env";
import type { ProviderArtifact, ProviderCitation, ProviderToolEvent } from "../runtime/types";

export type TurnRequest = {
  input: string;
  workspace?: string;
  lane?: string | null;
  mode?: string;
  profile?: string;
  surface?: string;
  sessionId?: string;
  newSession?: boolean;
  clientId?: string;
  extraSystemContext?: string;
};

export type TurnResponse = {
  requestId: string;
  sessionId: string;
  content: string;
  lane: RuntimeLane;
  traceSaved: boolean;
  contextReceipt: string[];
  toolExecutions: Array<{
    tool: string;
    summary: string;
    ok: boolean;
    changedFile?: string;
  }>;
  providerEvents: ProviderToolEvent[];
  citations: ProviderCitation[];
  artifacts: ProviderArtifact[];
  workspace: {
    cwd: string;
    repoRoot: string | null;
    branch: string | null;
    dirtyFiles: string[];
  };
  pendingApproval: import("../agent/turn-state").ApprovalRequest | null;
  route: { provider?: string; model?: string; using?: string } | null;
};

export type ApiErrorResponse = {
  error: { message: string; code: string };
};
