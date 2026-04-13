import React from "react";
import { Box, Text } from "ink";
import type { TranscriptEntry } from "../../agent/turn-state";
import type { DraftEdit, ApprovalRequest } from "../../agent/turn-state";
import { MarkdownText } from "./MarkdownText";

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
};

export function Transcript({
  activeCapability,
  entries,
  hasMoreAbove = false,
  hasMoreBelow = false,
  pendingApproval,
  pendingDraft,
  scrollOffset = 0,
  streamingText,
  thinking,
}: TranscriptProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      {hasMoreAbove && (
        <Text color="gray" dimColor>↑ more above · Ctrl+U to scroll</Text>
      )}

      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box gap={1}>
                <Text color="green" bold>❯</Text>
                <Text color="white">{entry.body}</Text>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1} paddingLeft={2}>
              <MarkdownText content={entry.body} role="assistant" />
            </Box>
          );
        }

        // tool entry — inline, compact
        if (entry.kind === "tool") {
          const isError = entry.tone === "error";
          const isSuccess = entry.tone === "success";
          return (
            <Box key={entry.id} marginBottom={0} paddingLeft={2}>
              <Text color={isError ? "red" : isSuccess ? "green" : "gray"} dimColor={!isError}>
                {isError ? "✗" : "✓"} {entry.title.toLowerCase()}
              </Text>
            </Box>
          );
        }

        return null;
      })}

      {/* Inline thinking indicator */}
      {thinking && !streamingText && !activeCapability && (
        <Box paddingLeft={2} marginBottom={0}>
          <Text color="gray" dimColor>⠸ {thinking}</Text>
        </Box>
      )}

      {/* Active capability */}
      {activeCapability && !streamingText && (
        <Box paddingLeft={2} marginBottom={0}>
          <Text color="yellow" dimColor>⠸ {activeCapability}...</Text>
        </Box>
      )}

      {/* Streaming response */}
      {streamingText && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
          <MarkdownText content={streamingText} role="assistant" />
        </Box>
      )}

      {/* Inline draft approval prompt */}
      {pendingApproval && pendingDraft && (
        <Box
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          marginTop={1}
          borderStyle="single"
          borderColor="yellow"
        >
          <Box gap={1} marginBottom={1}>
            <Text color="yellow" bold>draft ready</Text>
            <Text color="gray">·</Text>
            <Text color="white">{pendingDraft.targetPath}</Text>
          </Box>
          <Text color="gray" dimColor>{pendingApproval.summary}</Text>
          <Box marginTop={1} gap={2}>
            <Text color="green">yes / y / apply → apply patch</Text>
            <Text color="red">no / n / cancel → discard</Text>
          </Box>
        </Box>
      )}

      {hasMoreBelow && (
        <Text color="gray" dimColor>↓ more below · Ctrl+D to scroll</Text>
      )}
    </Box>
  );
}
