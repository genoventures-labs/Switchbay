import React, { useRef, useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

const THINKING_PHRASES = [
  "cranking up the wubs",
  "dropping the bass",
  "building the drop",
  "charging the wobble",
  "syncing to 140 BPM",
  "loading the filth",
  "warming up the sub",
  "dialing in the freq",
  "pre-drop tension rising",
  "the wub is loading",
  "oscillating violently",
  "riding the LFO",
  "about to go hard",
  "bass cannon primed",
  "summoning the wobble",
  "checking the wub levels",
  "tuning the growl",
  "modulating",
  "the drop is imminent",
  "bwomp incoming",
];

type ComposerProps = {
  activeCapability: string | null;
  disabled?: boolean;
  initialQuery: string;
  query: string;
  status: SessionStatus;
  thoughts?: string[];
  turnStartedAt?: number | null;
  turnTokenCount?: number;
};

export function Composer({
  activeCapability,
  disabled = false,
  initialQuery,
  query,
  status,
  thoughts = [],
  turnStartedAt = null,
  turnTokenCount = 0,
}: ComposerProps) {
  const isThinking = status === "THINKING";
  const phraseRef = useRef(THINKING_PHRASES[0]);
  const wasThinking = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  if (isThinking && !wasThinking.current) {
    phraseRef.current = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
    setElapsed(0);
  }
  wasThinking.current = isThinking;

  useEffect(() => {
    if (!isThinking || !turnStartedAt) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - turnStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isThinking, turnStartedAt]);

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;

  if (initialQuery) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true} borderColor="#707070" paddingX={1} paddingY={0}>
          <Text color="#707070">one-shot mode · Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  const brandColor = "#E57373";
  const grayColor = "#707070";

  return (
    <Box flexDirection="column">
      {isThinking && (
        <Box flexDirection="column" paddingX={2} marginBottom={0} marginTop={1}>
          <Box gap={1}>
            <Text color={brandColor}>⏺</Text>
            <Text color="white">{phraseRef.current}…</Text>
            <Text color={grayColor}>
              ({elapsed}s · {formatTokens(turnTokenCount)} · thinking)
            </Text>
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
