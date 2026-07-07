import React from "react";
import { Box, Text } from "ink";
import { TUI_COLORS } from "../theme";

type ShortcutDrawerProps = {
  visible: boolean;
};

const SHORTCUTS = [
  { key: "/", label: "Slash commands", description: "Browse and run internal commands" },
  { key: "@", label: "File mentions", description: "Add file/directory context to your query" },
  { key: "Ctrl+L", label: "Toggle lane", description: "Switch between Cloud and LM Studio lanes" },
  { key: "/collapse", label: "Toggle panels", description: "Hide or show right-side telemetry" },
  { key: "/skills", label: "Skills drawer", description: "Browse reusable Toolbox skills" },
  { key: "/model", label: "Model drawer", description: "Pick a cloud preset or LM Studio model" },
  { key: "?", label: "Help", description: "Show this shortcuts drawer" },
  { key: "Ctrl+U", label: "Scroll up", description: "Page up through the transcript" },
  { key: "Ctrl+D", label: "Scroll down", description: "Page down through the transcript" },
  { key: "Ctrl+C", label: "Exit", description: "Terminate the current session" },
  { key: "Esc", label: "Cancel", description: "Clear current input or close drawers" },
];

export function ShortcutDrawer({ visible }: ShortcutDrawerProps) {
  if (!visible) return null;

  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;

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
        <Text color={brandColor} bold>Keyboard Shortcuts</Text>
      </Box>

      {SHORTCUTS.map((s, i) => (
        <Box key={i} gap={2} paddingX={1}>
          <Box width={10}>
            <Text color={greenColor} bold>{s.key}</Text>
          </Box>
          <Box width={20}>
            <Text color={TUI_COLORS.text} bold>{s.label}</Text>
          </Box>
          <Text color={grayColor}>└ {s.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
