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
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true} borderColor="gray" paddingX={1} paddingY={0}>
          <Text color="gray" dimColor>one-shot mode · Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  const borderColor = isThinking ? "yellow" : disabled ? "magenta" : "cyan";
  const titleColor = isThinking ? "yellow" : disabled ? "magenta" : "cyan";
  const placeholder = disabled
    ? "Describe what you want to change..."
    : "Ask ORI a question or describe an edit...";

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={1}>
      <Box
        borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true}
        borderColor="gray"
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        <Box justifyContent="space-between">
          <Text color={titleColor} bold>
            {disabled ? "Edit intent" : "ORI Code"}
          </Text>
          {isThinking && (
            <Text color="yellow" dimColor>
              {activeCapability ? `${activeCapability}...` : "thinking..."}
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>> </Text>
          <Text color="gray"> · </Text>
          <Text color={query ? "white" : "gray"} dimColor={!query}>
            {query || placeholder}
            {!isThinking && !disabled ? (
              <Text backgroundColor="white" color="black"> </Text>
            ) : null}
          </Text>
        </Box>
      </Box>
      <Box marginTop={0} paddingX={1}>
        <Text color="gray" dimColor>
          {disabled
            ? "Enter to draft the change · Esc to cancel"
            : "Enter to send · Tab completes drawers · Ctrl+U / Ctrl+D scroll"}
        </Text>
      </Box>
    </Box>
  );
}
