import React from "react";
import { Box, Text } from "ink";
import type { TranscriptEntry } from "../../agent/turn-state";
import type { ApprovalRequest } from "../../agent/turn-state";
import type { PendingAgentDraft } from "../../agent/loop";
import type { ActivePlan } from "../../agent/turn-state";
import { MarkdownText } from "./MarkdownText";
import { WelcomeBoard } from "./WelcomeBoard";
import { PlanPanel } from "./PlanPanel";
import { TUI_COLORS } from "../theme";

type TranscriptProps = {
  lane: string;
  entries: TranscriptEntry[];
  hasMoreAbove?: boolean;
  hasMoreBelow?: boolean;
  pendingApproval: ApprovalRequest | null;
  pendingAgentDraft?: PendingAgentDraft | null;
  activePlan?: ActivePlan | null;
  scrollOffset?: number;
  streamingText: string;
  terminalWidth?: number;
};

export function Transcript({
  lane,
  entries,
  hasMoreAbove = false,
  hasMoreBelow = false,
  pendingApproval,
  pendingAgentDraft,
  activePlan,
  streamingText,
  terminalWidth = 120,
}: TranscriptProps) {
  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;
  const dimColor = TUI_COLORS.surfaceRaised;

  return (
    <Box flexDirection="column" flexGrow={1} paddingTop={1}>
      {hasMoreAbove && (
        <Box marginBottom={1}>
          <Text color={grayColor}>↑ scroll up  Ctrl+U</Text>
        </Box>
      )}

      {entries.length === 0 && !streamingText ? (
        <WelcomeBoard
          appName="Switchbay"
          version="0.9.48"
          lane={lane}
          cwd={process.cwd()}
          terminalWidth={terminalWidth}
        />
      ) : null}

      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="column">
                <Text color={grayColor}>❯ <Text color={TUI_COLORS.text}>{entry.body}</Text></Text>
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
                  <Text color={TUI_COLORS.text} bold>Switchbay</Text>
                </Box>
                <Box paddingLeft={2} marginTop={0} flexShrink={1} flexDirection="column">
                  <MarkdownText content={entry.body} role="assistant" terminalWidth={terminalWidth - 4} />
                </Box>
              </Box>
            </Box>
          );
        }

        if (entry.kind === "tool") {
          if (entry.tone === "warning") {
            return (
              <Box key={entry.id} flexDirection="column" marginBottom={1}>
                <Text color={brandColor}>! <Text color={grayColor}>{entry.title}</Text></Text>
              </Box>
            );
          }
          if (entry.tone === "error") {
            return (
              <Box key={entry.id} flexDirection="column" marginBottom={0}>
                <Text color={brandColor}>x <Text color={grayColor}>{entry.body || entry.title}</Text></Text>
              </Box>
            );
          }
          if (entry.tone === "info" && entry.body) {
            return (
              <Box key={entry.id} flexDirection="column" marginBottom={0}>
                <Text color={dimColor}>↳ {entry.body}</Text>
              </Box>
            );
          }
          return null;
        }

        return null;
      })}

      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color={brandColor}>⏺</Text>
              <Text color={TUI_COLORS.text} bold>Switchbay</Text>
            </Box>
            <Box paddingLeft={2} marginTop={0} flexShrink={1} flexDirection="column">
              <MarkdownText content={streamingText} role="assistant" terminalWidth={terminalWidth - 4} />
            </Box>
          </Box>
        </Box>
      )}

      {activePlan && (
        <PlanPanel plan={activePlan} />
      )}

      {pendingApproval?.kind === "shell_command" && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={brandColor} paddingX={2} paddingY={1} backgroundColor={TUI_COLORS.baseDeep}>
          <Box gap={1} marginBottom={1}>
            <Text color={brandColor} bold>Run Command</Text>
          </Box>
          <Text color={TUI_COLORS.text}>{pendingApproval.summary}</Text>
          <Box marginTop={1} gap={3}>
            <Text color={greenColor}>y → run</Text>
            <Text color={grayColor}>n → skip</Text>
          </Box>
        </Box>
      )}

      {pendingAgentDraft && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={brandColor} paddingX={2} paddingY={1}>
          <Box gap={1} marginBottom={1}>
            <Text color={brandColor} bold>🤖 Save Agent</Text>
            <Text color={grayColor}>·</Text>
            <Text color={TUI_COLORS.text} bold>{pendingAgentDraft.name}</Text>
          </Box>
          <Text color={grayColor}>{pendingAgentDraft.savePath}</Text>
          <Box marginTop={1} gap={3}>
            <Text color={greenColor}>y → save</Text>
            <Text color={grayColor}>n → discard</Text>
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
