import React from "react";
import { Box, Text } from "ink";
import { TUI_COLORS } from "../theme";

type SessionInfo = {
  id: string;
  title: string;
  updatedAt: number;
};

type ResumeDrawerProps = {
  sessions: SessionInfo[];
  selectedIndex: number;
  visible: boolean;
};

export function ResumeDrawer({
  sessions,
  selectedIndex,
  visible,
}: ResumeDrawerProps) {
  if (!visible) {
    return null;
  }

  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;

  const visibleCount = Math.min(sessions.length, 8);
  const startIndex = Math.max(0, Math.min(selectedIndex - 4, sessions.length - visibleCount));
  const visibleSessions = sessions.slice(startIndex, startIndex + visibleCount);

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginTop={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={grayColor}
    >
      <Box marginBottom={1}>
        <Text color={brandColor} bold>Resume Session</Text>
        <Text color={grayColor} wrap="truncate"> · Use arrow keys to select</Text>
      </Box>

      {sessions.length > 0 ? (
        visibleSessions.map((session, offset) => {
          const index = startIndex + offset;
          const selected = index === selectedIndex;
          const date = new Date(session.updatedAt).toLocaleString();

          return (
            <Box
              key={session.id}
              flexDirection="column"
              marginTop={selected ? 1 : 0}
              marginBottom={selected ? 1 : 0}
              paddingX={1}
              paddingY={selected ? 1 : 0}
              backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? greenColor : grayColor} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color={TUI_COLORS.text} bold={selected} wrap="truncate">
                  {session.title}
                </Text>
              </Box>

              {selected && (
                <Box flexDirection="column" marginLeft={2} marginTop={0}>
                  <Text color={grayColor} wrap="truncate">└ Last updated: {date}</Text>
                  <Text color={grayColor} wrap="truncate">  ID: {session.id}</Text>
                </Box>
              )}
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No saved sessions found.</Text>
      )}
      {sessions.length > visibleCount && (
        <Box paddingX={1}>
          <Text color={grayColor} wrap="truncate">... {sessions.length - visibleCount} more sessions</Text>
        </Box>
      )}
    </Box>
  );
}
