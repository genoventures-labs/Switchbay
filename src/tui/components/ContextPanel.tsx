import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest, DraftEdit } from "../../agent/turn-state";
import type { PatchPreview } from "../../tools/patch";
import type { WorkspaceSnapshot } from "../../session/workspace";
import type { VerificationSummary } from "../../tools/verify";
import type { ScratchpadState } from "../../runtime/types";

type ContextPanelProps = {
  changedFiles: string[];
  currentObjective: string | null;
  lastPatchPreview: PatchPreview | null;
  pendingApproval: ApprovalRequest | null;
  pendingDraft: DraftEdit | null;
  pendingPlan: string[];
  scratchpad: ScratchpadState | null;
  verification: VerificationSummary | null;
  workspace: WorkspaceSnapshot | null;
};

function verificationColor(verification: VerificationSummary | null) {
  if (!verification) {
    return "white";
  }

  if (verification.status === "passed") {
    return "green";
  }

  if (verification.status === "no_tests") {
    return "yellow";
  }

  return "red";
}

export function ContextPanel({
  changedFiles,
  currentObjective,
  lastPatchPreview,
  pendingApproval,
  pendingDraft,
  pendingPlan,
  scratchpad,
  verification,
  workspace,
}: ContextPanelProps) {
  const workspaceLabel = workspace
    ? `${workspace.repoRoot ?? workspace.cwd} · ${workspace.branch ?? "no-branch"} · ${workspace.dirtyFiles.length} dirty`
    : "Loading workspace context...";

  const draftLabel = pendingApproval
    ? pendingApproval.title
    : pendingDraft
      ? `${pendingDraft.targetPath} pending approval`
      : lastPatchPreview
        ? `${lastPatchPreview.targetPath} last patch`
        : "No patch preview yet.";

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Text color="gray">objective</Text>
          <Text color="white">
            {currentObjective ?? "Waiting for the first task."}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">scratchpad</Text>
        <Text color={scratchpad?.status === "stale" ? "gray" : "white"}>
          {scratchpad?.task ?? "No active scratchpad task."}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">workspace</Text>
        <Text color="white">{workspaceLabel}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">plan</Text>
        {pendingPlan.length > 0 ? (
          pendingPlan.slice(0, 4).map((item, index) => (
            <Text key={`${item}-${index}`} color="white">
              {index + 1}. {item}
            </Text>
          ))
        ) : (
          <Text color="white">No active plan yet.</Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">verification</Text>
        <Text color={verificationColor(verification)}>
          {verification
            ? verification.summary
            : "Run /verify to execute bun test."}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">edits</Text>
        {changedFiles.length > 0 ? (
          changedFiles.slice(0, 4).map((file) => (
            <Text key={file} color="white">
              {file}
            </Text>
          ))
        ) : (
          <Text color="white">No tracked edits yet.</Text>
        )}
      </Box>

      <Box flexDirection="column">
        <Text color="gray">draft</Text>
        <Text color="white">{draftLabel}</Text>
        {pendingApproval ? (
          <Text color="yellow">{pendingApproval.commandHint}</Text>
        ) : pendingDraft ? (
          <Text color="yellow">Use /apply or /cancel</Text>
        ) : null}
      </Box>
    </Box>
  );
}
