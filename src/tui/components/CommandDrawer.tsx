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

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      marginBottom={0}
    >
      <Text color="cyan" bold>
        Slash Commands
      </Text>
      <Text color="gray">Use arrow keys to browse. Press Tab to insert.</Text>
      {commands.length > 0 ? (
        commands.map((item, index) => {
          const selected = index === selectedIndex;

          return (
            <Box key={item.command} flexDirection="column" marginTop={1}>
              <Text color={selected ? "yellow" : "white"} bold={selected}>
                {selected ? ">" : " "} {item.command} <Text color="cyan">{item.category}</Text>
              </Text>
              <Text color="white">{item.description}</Text>
              <Text color="gray">{item.example}</Text>
            </Box>
          );
        })
      ) : (
        <Text color="white">No matching slash commands.</Text>
      )}
    </Box>
  );
}
