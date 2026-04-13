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
        <Text color="gray" dimColor>one-shot mode · Ctrl+C to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={1}>
      {/* Thinking status line — only shown when active */}
      {isThinking && (
        <Box marginBottom={1}>
          <Text color="yellow" dimColor>
            {activeCapability ? `⠸ ${activeCapability}...` : "⠸ thinking..."}
          </Text>
        </Box>
      )}

      {/* Input line */}
      {!disabled && (
        <Box gap={1}>
          <Text color={isThinking ? "gray" : "green"} bold>❯</Text>
          <Text color={isThinking ? "gray" : "white"}>
            {query}
            {!isThinking && (
              <Text backgroundColor="white" color="black"> </Text>
            )}
          </Text>
        </Box>
      )}

      {/* Hint line */}
      <Box marginTop={0}>
        <Text color="gray" dimColor>
          {disabled
            ? "describe the change · Enter to draft · Esc to cancel"
            : "Enter · / for commands · Tab completes · Ctrl+U/D scroll"}
        </Text>
      </Box>
    </Box>
  );
}
