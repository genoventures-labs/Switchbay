import React from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";
import type { ScratchpadState } from "../../runtime/types";

type StatusBarProps = {
  activeCapability: string | null;
  currentThought?: string | null;
  scratchpad: ScratchpadState | null;
  status: SessionStatus;
};

function getStatusColor(status: SessionStatus) {
  if (status === "READY" || status === "CONNECTED" || status === "DISCONNECTED") {
    return "green";
  }

  if (status === "ERROR") {
    return "red";
  }

  return "yellow";
}

export function StatusBar({ activeCapability, currentThought, scratchpad, status }: StatusBarProps) {
  return (
    <Box
      paddingX={1}
      marginBottom={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color="gray">status </Text>
        <Text color={getStatusColor(status)} bold>
          {status === "DISCONNECTED" ? "READY" : status}
        </Text>
        <Text color="gray">
          {activeCapability ? "  active " : "  idle "}
        </Text>
        {activeCapability ? (
          <Text color="yellow">{activeCapability}</Text>
        ) : null}
      </Box>

      <Box>
        {scratchpad?.task ? (
          <Text color={scratchpad.status === "stale" ? "gray" : "cyan"}>
            <Text color="gray">task </Text>
            {scratchpad.task}
            <Text color="gray"> ({scratchpad.status}) </Text>
          </Text>
        ) : null}
        {currentThought ? (
          <Text color="gray">
            <Text color="yellow"> now</Text> {currentThought}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
