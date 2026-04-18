import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

const THINKING_PHRASES = [
  "cooking something up…",
  "staring into the void…",
  "asking the oracle…",
  "vibing…",
  "plotting…",
  "doing the math…",
  "checking the vibe…",
  "connecting the dots…",
  "summoning an answer…",
  "thinking thoughts…",
  "consulting the ancient texts…",
  "running it back…",
  "in the lab…",
  "reading between the lines…",
  "loading genius…",
  "on it…",
  "crunching…",
  "big brain moment…",
  "firing neurons…",
  "channeling the grid…",
];

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
  const phraseRef = useRef(THINKING_PHRASES[0]);
  const wasThinking = useRef(false);

  if (isThinking && !wasThinking.current) {
    phraseRef.current = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
  }
  wasThinking.current = isThinking;

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
    <Box flexDirection="column">
      {isThinking && (
        <Box flexDirection="column" paddingX={2} marginBottom={0} marginTop={1}>
          <Box gap={1}>
            <Text color={brandColor}>⏺</Text>
            <Text color="white" bold>ORI <Text color={grayColor}>({phraseRef.current})</Text></Text>
          </Box>
          {thoughts.map((t, i) => (
            <Box key={i} paddingLeft={2}>
              <Text color={grayColor}>└ {t}</Text>
            </Box>
          ))}
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
        paddingY={1}
        flexDirection="column"
        marginTop={1}
      >
        <Box marginY={0}>
          <Text color={grayColor}>❯ </Text>
          <Text color={query ? "white" : brandColor}>
            {query || (disabled ? "Describe what you want to change..." : "Ask ORI a question or describe an edit...")}
            {!isThinking && !disabled ? (
              <Text backgroundColor="white" color="black"> </Text>
            ) : null}
          </Text>
        </Box>
      </Box>
      
      <Box paddingX={2} paddingTop={0} paddingBottom={1}>
        <Text color={grayColor}>
          {disabled ? (
            <Text>Enter to <Text color={brandColor}>draft</Text> · Esc to <Text color={brandColor}>cancel</Text></Text>
          ) : (
            <Text>? for <Text color={brandColor}>shortcuts</Text> · / for <Text color={brandColor}>commands</Text></Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
