import React from "react";
import { Box, Text } from "ink";
import type { SlashCommand } from "../commands";
import { TUI_COLORS } from "../theme";

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

  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;

  const visibleCount = Math.min(commands.length, 6);
  const startIndex = Math.max(0, Math.min(selectedIndex - 3, commands.length - visibleCount));
  const visibleCommands = commands.slice(startIndex, startIndex + visibleCount);

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
        <Text color={brandColor} bold>Commands</Text>
        <Text color={grayColor}> · {commands.length} matches · arrows browse · tab inserts · enter runs</Text>
      </Box>

      {commands.length > 0 ? (
        visibleCommands.map((item, offset) => {
          const index = startIndex + offset;
          const selected = index === selectedIndex;

          return (
            <Box
              key={item.command}
              flexDirection="column"
              marginTop={0}
              marginBottom={0}
              paddingX={1}
              paddingY={0}
              backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? greenColor : grayColor} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color={TUI_COLORS.text} bold={selected}>
                  {item.command}
                </Text>
                <Text color={grayColor}>[{item.category}]</Text>
              </Box>
              
              {selected && (
                <Box flexDirection="column" marginLeft={2} marginTop={0}>
                  <Text color={TUI_COLORS.text}>{item.description}</Text>
                  <Text color={grayColor}>{item.example}</Text>
                </Box>
              )}
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No matching slash commands.</Text>
      )}
      {commands.length > visibleCount && (
        <Box paddingX={1}>
          <Text color={grayColor}>... {commands.length - visibleCount} more</Text>
        </Box>
      )}
    </Box>
  );
}
