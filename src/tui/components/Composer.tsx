import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

type ComposerProps = {
  activeCapability: string | null;
  disabled?: boolean;
  initialQuery: string;
  query: string;
  status: SessionStatus;
  thoughts?: string[];
};

export function Composer({
  activeCapability,
  disabled = false,
  initialQuery,
  query,
  status,
  thoughts = [],
}: ComposerProps) {
  const isThinking = status === "THINKING";

  if (initialQuery) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true} borderColor="#707070" paddingX={1} paddingY={0}>
          <Text color="#707070">one-shot mode · Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  const brandColor = "#E57373"; // Salmon/Coral
  const greenColor = "#00FF7F"; // Bright Spring Green
  const grayColor = "#707070";  // Steel Gray

  return (
    <Box flexDirection="column" paddingX={0} paddingTop={0} paddingBottom={0}>
      {isThinking && (
        <Box flexDirection="column" paddingX={2} marginBottom={0} marginTop={1}>
          <Box gap={1}>
            <Text color={brandColor}>⏺</Text>
            <Text color="white" bold>ORI</Text>
          </Box>
          {thoughts.length > 0 ? (
            thoughts.map((t, i) => (
              <Box key={i} paddingLeft={2}>
                <Text color={grayColor}>└ {t}</Text>
              </Box>
            ))
          ) : (
            <Box paddingLeft={2}>
              <Text color={grayColor}>└ thinking...</Text>
            </Box>
          )}
        </Box>
      )}

      <Box
        borderStyle="single" 
        borderLeft={false} 
        borderRight={false} 
        borderBottom={true} 
        borderTop={true}
        borderColor={grayColor}
        paddingX={2}
        paddingY={0}
        flexDirection="column"
        marginTop={1}
      >
        <Box marginY={0}>
          <Text color={grayColor}>❯ </Text>
          <Text color={query ? "white" : grayColor}>
            {query || (disabled ? "Describe what you want to change..." : "Ask ORI a question or describe an edit...")}
            {!isThinking && !disabled ? (
              <Text backgroundColor="white" color="black"> </Text>
            ) : null}
          </Text>
        </Box>
      </Box>
      
      <Box paddingX={2} paddingTop={0} paddingBottom={1}>
        <Text color={grayColor}>
          {disabled
            ? "Enter to draft · Esc to cancel"
            : "? for shortcuts · / for commands"}
        </Text>
      </Box>
    </Box>
  );
}
