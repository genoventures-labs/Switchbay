import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "../../agent/turn-state";

type ApprovalPanelProps = {
  approval: ApprovalRequest | null;
};

export function ApprovalPanel({ approval }: ApprovalPanelProps) {
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color="gray">approval</Text>
      {approval ? (
        <>
          <Text color="yellow" bold>
            {approval.title}
          </Text>
          <Text color="white">{approval.summary}</Text>
          <Text color="gray">{approval.commandHint}</Text>
        </>
      ) : (
        <Text color="white">No pending approvals.</Text>
      )}
    </Box>
  );
}
