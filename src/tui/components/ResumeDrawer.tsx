import React from "react";
import { Box, Text } from "ink";

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

  const brandColor = "#E57373"; // Salmon/Coral
  const greenColor = "#00FF7F"; // Bright Spring Green
  const grayColor = "#707070";  // Steel Gray

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
        <Text color={grayColor}> · Use arrow keys to select</Text>
      </Box>

      {sessions.length > 0 ? (
        sessions.map((session, index) => {
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
              backgroundColor={selected ? "#2D333B" : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? greenColor : grayColor} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color="white" bold={selected}>
                  {session.title}
                </Text>
              </Box>
              
              {selected && (
                <Box flexDirection="column" marginLeft={2} marginTop={0}>
                  <Text color={grayColor}>└ Last updated: {date}</Text>
                  <Text color={grayColor}>  ID: {session.id}</Text>
                </Box>
              )}
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No saved sessions found.</Text>
      )}
    </Box>
  );
}
