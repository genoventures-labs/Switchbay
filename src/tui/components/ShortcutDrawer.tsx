import React from "react";
import { Box, Text } from "ink";
import { TUI_COLORS } from "../theme";

type ShortcutDrawerProps = {
  visible: boolean;
};

const HELP_SECTIONS = [
  {
    title: "Start here",
    items: [
      { key: "/", label: "All commands", description: "Search the complete command catalog" },
      { key: "/model", label: "Models", description: "Choose a lane/model; /auto restores routing" },
      { key: "/workspace", label: "Workspace", description: "Inspect, add, or hop between projects" },
      { key: "/plan", label: "Planner", description: "Break work into visible resumable steps" },
    ],
  },
  {
    title: "Context and work",
    items: [
      { key: "/context", label: "Your context", description: "Inspect private machine-local guidance" },
      { key: "/memory", label: "Memory", description: "Workspace notes and structured facts" },
      { key: "/index", label: "Knowledge", description: "Index and search sourced project docs" },
      { key: "/agenda", label: "Daily Board", description: "View or manage today's tasks" },
      { key: "/trace", label: "Receipts", description: "Inspect turns, tools, routing, and graphs" },
    ],
  },
  {
    title: "Capabilities",
    items: [
      { key: "/agents", label: "Agents", description: "Activate a specialist role" },
      { key: "/skills", label: "Skills", description: "Browse reusable working methods" },
      { key: "/engines", label: "Engines", description: "Browse registered tool packs" },
      { key: "/plugins", label: "Plugins", description: "Inspect bundled capabilities" },
      { key: "/mcp", label: "MCP", description: "Inspect trusted external integrations" },
      { key: "/native", label: "Native tools", description: "Inspect isolated and provider tools" },
    ],
  },
  {
    title: "Keyboard",
    items: [
      { key: "@", label: "Mention files", description: "Add a file or directory to your request" },
      { key: "Ctrl+L", label: "Toggle lane", description: "Cycle trusted cloud and local lanes" },
      { key: "Ctrl+U/D", label: "Scroll", description: "Page through the persistent work feed" },
      { key: "/collapse", label: "Panels", description: "Hide or show right-side telemetry" },
      { key: "Esc", label: "Close", description: "Clear input or close the active drawer" },
      { key: "Ctrl+C", label: "Exit", description: "End the current TUI process" },
    ],
  },
] as const;

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
        <Text color={brandColor} bold>Switchbay Help</Text>
        <Text color={grayColor}>  ? or /help to toggle · type / to search everything</Text>
      </Box>

      {HELP_SECTIONS.map((section) => (
        <Box key={section.title} flexDirection="column" marginBottom={1}>
          <Text color={greenColor} bold>{section.title.toUpperCase()}</Text>
          {section.items.map((item) => (
            <Box key={item.key} gap={1} paddingLeft={1}>
              <Box width={12}><Text color={brandColor} bold>{item.key}</Text></Box>
              <Box width={16}><Text color={TUI_COLORS.text}>{item.label}</Text></Box>
              <Text color={grayColor}>· {item.description}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
