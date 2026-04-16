import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

type ComposerProps = {
  activeCapability: string | null;
  disabled?: boolean;
  initialQuery: string;
  query: string;
  status: SessionStatus;
};

const THINKING_PHRASES = [
  "Polishing the symbols...",
  "Consulting the Oracle...",
  "Drafting the plan...",
  "Reading between the lines...",
  "Aligning the stars...",
  "Sifting through the repo...",
  "Thinking it over...",
  "Almost there...",
  "Waking up the daemons...",
  "Sharpening the tools...",
];

export function Composer({
  activeCapability,
  disabled = false,
  initialQuery,
  query,
  status,
}: ComposerProps) {
  const isThinking = status === "THINKING";
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!isThinking) return;
    
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % THINKING_PHRASES.length);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isThinking]);

  if (initialQuery) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true} borderColor="#707070" paddingX={1} paddingY={0}>
          <Text color="#707070">one-shot mode · Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  const greenColor = "#00FF7F"; // Bright Spring Green
  const grayColor = "#707070";  // Steel Gray

  return (
    <Box flexDirection="column" paddingX={0} paddingTop={0} paddingBottom={0}>
      {isThinking && (
        <Box paddingX={2} marginBottom={0} marginTop={1}>
          <Box gap={1}>
            <Text color={greenColor}>⏺</Text>
            <Text color="white" bold>{activeCapability ? activeCapability.toLowerCase() : "thinking"}</Text>
            <Text color={grayColor}> · {THINKING_PHRASES[phraseIndex]}</Text>
          </Box>
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
        marginTop={isThinking ? 1 : 1}
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
