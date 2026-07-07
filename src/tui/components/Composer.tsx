import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionStatus } from "../../agent/turn-state";
import { TUI_COLORS } from "../theme";

const PHRASES_CORE = [
  "connecting the dots",
  "checking context",
  "validating response",
  "reading between the lines",
  "cooking something up",
  "checking the workspace",
  "reading the diff",
  "planning the next step",
  "doing the math",
  "lining up the tools",
  "on it",
];

function pickPhrase(): string {
  return PHRASES_CORE[Math.floor(Math.random() * PHRASES_CORE.length)] ?? "thinking";
}

type ComposerProps = {
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
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTop={true} borderColor={TUI_COLORS.surfaceRaised} paddingX={1} paddingY={0}>
          <Text color={TUI_COLORS.muted}>one-shot mode · Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  const brandColor = TUI_COLORS.accentBright;
  const grayColor = TUI_COLORS.muted;

  return (
    <Box flexDirection="column">
      {isThinking && (
        <Box flexDirection="column" paddingX={2} marginBottom={0} marginTop={1}>
          <Box gap={1}>
            <Text color={brandColor}>⏺</Text>
            <Text color={TUI_COLORS.text}>{phrase}…</Text>
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
        borderColor={TUI_COLORS.surfaceRaised}
        backgroundColor={TUI_COLORS.baseDeep}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        marginTop={1}
      >
        <Box marginY={0}>
          <Text color={grayColor}>❯ </Text>
          <Text color={query ? TUI_COLORS.text : brandColor}>
            {query || (disabled ? "Describe what you want to change..." : "Ask a question or describe an edit...")}
            {!isThinking && !disabled ? (
              <Text backgroundColor={TUI_COLORS.accentBright} color={TUI_COLORS.base}> </Text>
            ) : null}
          </Text>
        </Box>
      </Box>

      <Box paddingX={2} paddingTop={0} paddingBottom={1}>
        <Text color={grayColor}>
          {pendingApprovalKind === "shell_command" ? (
            <Text><Text color={grayColor}>1</Text> no · <Text color={brandColor}>2</Text> yes · <Text color={brandColor}>3</Text> yes always</Text>
          ) : pendingApprovalKind === "agent_draft" ? (
            <Text><Text color={grayColor}>1</Text> discard · <Text color={brandColor}>2</Text> save</Text>
          ) : pendingApprovalKind === "plan_approval" ? (
            <Text><Text color={grayColor}>1</Text> cancel · <Text color={brandColor}>2</Text> execute plan</Text>
          ) : pendingApprovalKind === "plan_continue" ? (
            <Text><Text color={brandColor}>2</Text> next step · <Text color={grayColor}>skip</Text> · <Text color={grayColor}>stop</Text></Text>
          ) : disabled ? (
            <Text>Enter to <Text color={brandColor}>draft</Text> · Esc to <Text color={brandColor}>cancel</Text></Text>
          ) : (
            <Text>? shortcuts · / commands · <Text color={brandColor}>Ctrl+L</Text> lane</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
