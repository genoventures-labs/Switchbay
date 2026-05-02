import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";

const PHRASES_CORE = [
  "connecting the dots",
  "checking context",
  "validating response",
  "asking the oracle",
  "reading between the lines",
  "consulting the ancient texts",
  "cooking something up",
  "loading genius",
  "firing neurons",
  "in the lab",
  "running it back",
  "doing the math",
  "channeling the grid",
  "summoning an answer",
  "on it",
];

const PHRASES_WUB = [
  "cranking up the wubs",
  "dropping the bass",
  "building the drop",
  "charging the wobble",
  "syncing to 140 BPM",
  "loading the filth",
  "warming up the sub",
  "riding the LFO",
  "bass cannon primed",
  "summoning the wobble",
  "the drop is imminent",
  "bwomp incoming",
  "oscillating violently",
  "tuning the growl",
  "pre-drop tension rising",
];

function pickPhrase(): string {
  const wubMode = Math.random() < 0.2;
  const pool = wubMode ? PHRASES_WUB : PHRASES_CORE;
  return pool[Math.floor(Math.random() * pool.length)];
}

type ComposerProps = {
  activeCapability: string | null;
  disabled?: boolean;
  initialQuery: string;
  pendingApprovalKind?: string | null;
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
  pendingApprovalKind = null,
  query,
  status,
  thoughts = [],
  turnStartedAt = null,
  turnTokenCount = 0,
}: ComposerProps) {
  const isThinking = status === "THINKING";
  const [phrase, setPhrase] = useState(pickPhrase());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isThinking || !turnStartedAt) return;
    setPhrase(pickPhrase());
    setElapsed(0);
    const ticker = setInterval(() => {
      setElapsed(Math.floor((Date.now() - turnStartedAt) / 1000));
      setPhrase(pickPhrase());
    }, 10000);
    return () => clearInterval(ticker);
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
            <Text color="white">{phrase}…</Text>
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
          {pendingApprovalKind === "shell_command" ? (
            <Text><Text color="yellow">y</Text> run · <Text color="red">n</Text> skip</Text>
          ) : pendingApprovalKind === "agent_draft" ? (
            <Text><Text color={brandColor}>y</Text> save agent · <Text color="red">n</Text> discard</Text>
          ) : disabled ? (
            <Text>Enter to <Text color={brandColor}>draft</Text> · Esc to <Text color={brandColor}>cancel</Text></Text>
          ) : (
            <Text>? for <Text color={brandColor}>shortcuts</Text> · / for <Text color={brandColor}>commands</Text></Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
