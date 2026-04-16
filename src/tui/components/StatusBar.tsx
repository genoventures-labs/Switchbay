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
    return "#00FF7F";
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
        
        <Text color="#707070" dimColor>
          {status === "DISCONNECTED" ? "READY" : status}
        </Text>
        <Text color="#707070">
          {activeCapability ? "  active " : "  idle "}
        </Text>
        {activeCapability ? (
          <Text color="#00FF7F" dimColor>{activeCapability}</Text>
        ) : null}
      </Box>

      <Box>
        {scratchpad?.task ? (
          <Text color={scratchpad.status === "stale" ? "#707070" : "cyan"}>
            <Text color="#707070">task </Text>
            {scratchpad.task}
            <Text color="#707070"> ({scratchpad.status}) </Text>
          </Text>
        ) : null}
        {currentThought ? (
          <Text color="#707070">
            <Text color="#707070" dimColor> now</Text> {currentThought}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
