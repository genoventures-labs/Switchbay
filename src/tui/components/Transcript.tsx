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
  activeCapability,
  entries,
  hasMoreAbove = false,
  hasMoreBelow = false,
  pendingApproval,
  pendingDraft,
  streamingText,
  thinking,
  terminalWidth = 120,
}: TranscriptProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingTop={1}>
      {hasMoreAbove && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>↑ scroll up  Ctrl+U</Text>
        </Box>
      )}

      {entries.length === 0 && !streamingText && !thinking ? (
        <WelcomeBoard
          version="0.4.6"
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
                <Text color="gray" dimColor>❯ <Text color="white">{entry.body}</Text></Text>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="column">
                <Box gap={1} marginBottom={0}>
                  <Text color="magenta">⏺</Text>
                  <Text color="white" bold>ORI</Text>
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
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={0}>
              <Box gap={1}>
                <Text color={isError ? "red" : "green"}>⏺</Text>
                <Text color="white" bold>{entry.title.toLowerCase()}</Text>
              </Box>
              <Box paddingLeft={1}>
                <Text color="gray" dimColor>└ {entry.summary || "completed"}</Text>
              </Box>
            </Box>
          );
        }

        return null;
      })}

      {(thinking || activeCapability) && !streamingText && (
        <Box flexDirection="column" marginBottom={1} marginTop={1}>
          <Box gap={1}>
            <Text color="green" dimColor>⏺</Text>
            <Text color="white" bold>{activeCapability ? activeCapability.toLowerCase() : "thinking"}</Text>
          </Box>
          <Box paddingLeft={1}>
             <Text color="gray" dimColor>└ Thinking...</Text>
          </Box>
        </Box>
      )}

      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color="magenta">⏺</Text>
              <Text color="white" bold>ORI</Text>
            </Box>
            <Box marginTop={1}>
              <MarkdownText content={streamingText} role="assistant" />
            </Box>
          </Box>
        </Box>
      )}

      {pendingApproval && pendingDraft && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
          <Box gap={1} marginBottom={1}>
            <Text color="magenta" bold>Draft Ready</Text>
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
