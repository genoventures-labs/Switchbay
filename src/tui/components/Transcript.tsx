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

      {entries.length === 0 && !streamingText && !thinking ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={2}
          paddingY={1}
          marginBottom={1}
        >
          <Text color="cyan" bold>Ready to help</Text>
          <Text color="gray" dimColor>
            I can help you understand the repo, make a plan, or edit code. What’s on your mind?
          </Text>
        </Box>
      ) : null}

      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                paddingY={0}
              >
                <Text color="gray" dimColor>you</Text>
                <Text color="white">{entry.body}</Text>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="cyan"
                paddingX={1}
                paddingY={0}
              >
                <Box gap={1} marginBottom={0}>
                  <Text color="cyan" bold>ori</Text>
                  <Text color="gray" dimColor>Assistant</Text>
                </Box>
                <Box marginTop={1}>
                  <MarkdownText content={entry.body} role="assistant" />
                </Box>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "tool") {
          const isError = entry.tone === "error";
          const isInfo = entry.tone === "info";
          const borderColor = isError ? "red" : isInfo ? "cyan" : "gray";
          const titleColor = isError ? "red" : isInfo ? "cyan" : "white";
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={borderColor}
                paddingX={1}
                paddingY={0}
              >
                <Box gap={1}>
                  <Text color={titleColor} bold>{entry.title}</Text>
                  <Text color="gray" dimColor>
                    {isError ? "error" : isInfo ? "info" : "tool"}
                  </Text>
                </Box>
                {entry.body.trim() ? (
                  <Box marginTop={1}>
                    <MarkdownText content={entry.body} role="tool" />
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        }

        return null;
      })}

      {(thinking || activeCapability) && !streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
            paddingY={0}
          >
            <Box gap={1}>
              <Text color="cyan" bold>ori</Text>
              <Text color="gray" dimColor>Thinking</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="yellow" dimColor>
                {activeCapability ? `${activeCapability}...` : thinking}
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            paddingY={0}
          >
            <Box gap={1}>
              <Text color="cyan" bold>ori</Text>
              <Text color="gray" dimColor>Responding</Text>
            </Box>
            <Box marginTop={1}>
              <MarkdownText content={streamingText} role="assistant" />
            </Box>
          </Box>
        </Box>
      )}

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
            <Text color="yellow" bold>Draft Ready</Text>
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
