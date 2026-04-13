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
  streamingText,
  thinking,
}: TranscriptProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      {hasMoreAbove && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>↑ scroll up  Ctrl+U</Text>
        </Box>
      )}

      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box gap={1} marginBottom={0}>
                <Text color="gray" dimColor>you</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color="white">{entry.body}</Text>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box gap={1} marginBottom={0}>
                <Text color="cyan" bold>ori</Text>
              </Box>
              <Box
                borderStyle="single"
                borderLeft={true}
                borderRight={false}
                borderTop={false}
                borderBottom={false}
                borderColor="cyan"
                paddingLeft={1}
              >
                <MarkdownText content={entry.body} role="assistant" />
              </Box>
            </Box>
          );
        }

        // tool entry — compact, dimmed
        if (entry.kind === "tool") {
          const isError = entry.tone === "error";
          const isInfo = entry.tone === "info";
          return (
            <Box key={entry.id} marginBottom={0} paddingLeft={2}>
              <Text
                color={isError ? "red" : isInfo ? "cyan" : "gray"}
                dimColor={!isError && !isInfo}
              >
                {isError ? "✗" : isInfo ? "◈" : "·"} {entry.title.toLowerCase()}
              </Text>
            </Box>
          );
        }

        return null;
      })}

      {/* Thinking / capability indicator */}
      {(thinking || activeCapability) && !streamingText && (
        <Box flexDirection="column" marginBottom={0}>
          <Box gap={1} marginBottom={0}>
            <Text color="cyan" bold>ori</Text>
          </Box>
          <Box
            borderStyle="single"
            borderLeft={true}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor="cyan"
            paddingLeft={1}
          >
            <Text color="yellow" dimColor>
              {activeCapability ? `${activeCapability}...` : thinking}
            </Text>
          </Box>
        </Box>
      )}

      {/* Streaming response — live ORI block */}
      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box gap={1} marginBottom={0}>
            <Text color="cyan" bold>ori</Text>
          </Box>
          <Box
            borderStyle="single"
            borderLeft={true}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor="cyan"
            paddingLeft={1}
          >
            <MarkdownText content={streamingText} role="assistant" />
          </Box>
        </Box>
      )}

      {/* Draft approval prompt */}
      {pendingApproval && pendingDraft && (
        <Box
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
        >
          <Box gap={1} marginBottom={1}>
            <Text color="yellow" bold>◈ draft ready</Text>
            <Text color="gray">·</Text>
            <Text color="white" bold>{pendingDraft.targetPath}</Text>
          </Box>
          <Text color="gray" dimColor>{pendingApproval.summary}</Text>
          <Box marginTop={1} gap={3}>
            <Text color="green">y / yes → apply</Text>
            <Text color="red">n / no → discard</Text>
          </Box>
        </Box>
      )}

      {hasMoreBelow && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>↓ scroll down  Ctrl+D</Text>
        </Box>
      )}
    </Box>
  );
}
