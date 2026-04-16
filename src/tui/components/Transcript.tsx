import React from "react";
import { Box, Text } from "ink";
import type { TranscriptEntry } from "../../agent/turn-state";
import type { DraftEdit, ApprovalRequest } from "../../agent/turn-state";
import { MarkdownText } from "./MarkdownText";
import { WelcomeBoard } from "./WelcomeBoard";

type TranscriptProps = {
  activeCapability: string | null;
  entries: TranscriptEntry[];
  hasMoreAbove?: boolean;
  hasMoreBelow?: boolean;
  pendingApproval: ApprovalRequest | null;
  pendingDraft: DraftEdit | null;
  scrollOffset?: number;
  streamingText: string;
  thinking: string | null;
  terminalWidth?: number;
};

export function Transcript({
  entries,
  hasMoreAbove = false,
  hasMoreBelow = false,
  pendingApproval,
  pendingDraft,
  streamingText,
  thinking,
  terminalWidth = 120,
}: TranscriptProps) {
  const brandColor = "#E57373"; // Salmon/Coral
  const greenColor = "#00FF7F"; // Bright Spring Green
  const grayColor = "#707070";  // Steel Gray

  return (
    <Box flexDirection="column" flexGrow={1} paddingTop={1}>
      {hasMoreAbove && (
        <Box marginBottom={1}>
          <Text color={grayColor}>↑ scroll up  Ctrl+U</Text>
        </Box>
      )}

      {entries.length === 0 && !streamingText && !thinking ? (
        <WelcomeBoard
          version="0.7.3"
          user="Mike"
          email="thatnotiondude@gmail.com"
          model="Sonnet 4.6"
          cwd={process.cwd()}
          terminalWidth={terminalWidth}
        />
      ) : null}

      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="column">
                <Text color={grayColor}>❯ <Text color="white">{entry.body}</Text></Text>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="column">
                <Box gap={1} marginBottom={0}>
                  <Text color={brandColor}>⏺</Text>
                  <Text color="white" bold>ORI</Text>
                </Box>
                <Box paddingLeft={2} marginTop={0}>
                  <Box marginRight={1}>
                    <Text color={grayColor}>└ </Text>
                  </Box>
                  <Box flexShrink={1} flexDirection="column">
                    <MarkdownText content={entry.body} role="assistant" />
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        }

        return null;
      })}

      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color={brandColor}>⏺</Text>
              <Text color="white" bold>ORI <Text color={grayColor}>(responding…)</Text></Text>
            </Box>
            <Box paddingLeft={2} marginTop={0}>
              <Box marginRight={1}>
                <Text color={grayColor}>└ </Text>
              </Box>
              <Box flexShrink={1} flexDirection="column">
                <MarkdownText content={streamingText} role="assistant" />
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {pendingApproval && pendingDraft && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={brandColor} paddingX={2} paddingY={1}>
          <Box gap={1} marginBottom={1}>
            <Text color={brandColor} bold>Draft Ready</Text>
            <Text color={grayColor}>·</Text>
            <Text color="white" bold>{pendingDraft.targetPath}</Text>
          </Box>
          <Text color={grayColor}>{pendingApproval.summary}</Text>
          <Box marginTop={1} gap={3}>
            <Text color={greenColor}>y / yes → apply</Text>
            <Text color="red">n / no → discard</Text>
          </Box>
        </Box>
      )}

      {hasMoreBelow && (
        <Box marginTop={1}>
          <Text color={grayColor}>↓ scroll down  Ctrl+D</Text>
        </Box>
      )}
    </Box>
  );
}
