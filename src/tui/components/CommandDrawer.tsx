import React from "react";
import { Box, Text } from "ink";
import type { SlashCommand } from "../commands";

type CommandDrawerProps = {
  commands: SlashCommand[];
  selectedIndex: number;
  visible: boolean;
};

export function CommandDrawer({
  commands,
  selectedIndex,
  visible,
}: CommandDrawerProps) {
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
        <Text color={brandColor} bold>Slash Commands</Text>
        <Text color={grayColor}> · Use arrow keys to browse</Text>
      </Box>

      {commands.length > 0 ? (
        commands.map((item, index) => {
          const selected = index === selectedIndex;

          return (
            <Box
              key={item.command}
              flexDirection="column"
              marginTop={0}
              marginBottom={0}
              paddingX={1}
              paddingY={selected ? 1 : 0}
              backgroundColor={selected ? "#2D333B" : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? greenColor : grayColor} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color="white" bold={selected}>
                  {item.command}
                </Text>
                <Text color={grayColor}>[{item.category}]</Text>
              </Box>
              
              {selected && (
                <Box flexDirection="column" marginLeft={2} marginTop={0}>
                  <Text color="white">{item.description}</Text>
                </Box>
              )}
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No matching slash commands.</Text>
      )}
    </Box>
  );
}
