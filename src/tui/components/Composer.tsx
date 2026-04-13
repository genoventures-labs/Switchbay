import React from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

type ComposerProps = {
  activeCapability: string | null;
  disabled?: boolean;
  initialQuery: string;
  query: string;
  status: SessionStatus;
};

export function Composer({
  activeCapability,
  disabled = false,
  initialQuery,
  query,
  status,
}: ComposerProps) {
  const isThinking = status === "THINKING";

  if (initialQuery) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="gray" dimColor>one-shot · Ctrl+C to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={1}>
      <Box
        borderStyle="round"
        borderColor={isThinking ? "gray" : disabled ? "gray" : "green"}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        {/* Label row */}
        <Box justifyContent="space-between">
          <Text color={isThinking ? "gray" : disabled ? "gray" : "green"} bold>
            {disabled ? "edit intent" : "message"}
          </Text>
          {isThinking && (
            <Text color="yellow" dimColor>
              {activeCapability ? `${activeCapability}...` : "thinking..."}
            </Text>
          )}
        </Box>

        {/* Input row */}
        {!disabled && (
          <Box marginTop={0}>
            <Text color={isThinking ? "gray" : "white"}>
              {query || ""}
              {!isThinking && (
                <Text backgroundColor="white" color="black"> </Text>
              )}
            </Text>
          </Box>
        )}
      </Box>

      {/* Hint */}
      <Box marginTop={0} paddingX={1}>
        <Text color="gray" dimColor>
          {disabled
            ? "describe the change · Enter to draft · Esc to cancel"
            : "Enter to send · @ for files · / for commands · Tab completes"}
        </Text>
      </Box>
    </Box>
  );
}
