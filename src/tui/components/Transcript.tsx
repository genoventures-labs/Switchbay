import React from "react";
import { Box, Text } from "ink";
import type { TranscriptEntry } from "../../agent/turn-state";
import { MarkdownText } from "./MarkdownText";

type TranscriptProps = {
  activeCapability: string | null;
  entries: TranscriptEntry[];
  hasMoreAbove?: boolean;
  hasMoreBelow?: boolean;
  scrollOffset?: number;
  streamingText: string;
};

export function Transcript({
  activeCapability,
  entries,
  hasMoreAbove = false,
  hasMoreBelow = false,
  scrollOffset = 0,
  streamingText,
}: TranscriptProps) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      marginRight={1}
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color="gray">conversation</Text>
        <Text color="gray">
          {scrollOffset > 0 ? `Scrolled ${scrollOffset}` : "Live"}{" "}
          {hasMoreAbove ? "↑" : ""}{hasMoreBelow ? "↓" : ""}
        </Text>
      </Box>

      {entries.length === 0 && !streamingText ? (
        <Text color="gray" italic>Starting up...</Text>
      ) : null}

      {entries.map((entry) => (
        <Box
          key={entry.id}
          flexDirection="column"
          marginBottom={1}
          paddingLeft={entry.kind === "tool" ? 1 : 0}
        >
          <Text
            bold
            color={
              entry.kind === "user"
                ? "cyan"
                : entry.kind === "assistant"
                  ? "magenta"
                  : entry.tone === "error"
                    ? "red"
                    : entry.tone === "warning"
                      ? "yellow"
                      : entry.tone === "success"
                        ? "green"
                        : "gray"
            }
          >
            {entry.kind === "user"
              ? "> you"
              : entry.kind === "assistant"
                ? "ori"
                : `tool · ${entry.title.toLowerCase()}`}
          </Text>
          <MarkdownText
            content={entry.body}
            role={
              entry.kind === "user"
                ? "user"
                : entry.kind === "tool"
                  ? "tool"
                  : "assistant"
            }
          />
        </Box>
      ))}

      {(streamingText || activeCapability) && (
        <Box flexDirection="column">
          {activeCapability && (
            <Box marginBottom={1}>
              <Text color="yellow" italic>
                ◒ using {activeCapability}...
              </Text>
            </Box>
          )}
          <Box>
            <Text bold color="magenta">
              ori{" "}
            </Text>
            <MarkdownText content={streamingText} role="assistant" />
          </Box>
        </Box>
      )}
    </Box>
  );
}
