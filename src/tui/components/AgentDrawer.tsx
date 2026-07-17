import React from "react";
import { Box, Text } from "ink";
import type { Agent } from "../../agent/agents";
import { TUI_COLORS } from "../theme";

type AgentDrawerProps = {
  agents: Agent[];
  activeAgentId: string | null;
  selectedIndex: number;
  visible: boolean;
};

export function AgentDrawer({ agents, activeAgentId, selectedIndex, visible }: AgentDrawerProps) {
  if (!visible) return null;

  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;

  const visibleCount = Math.min(agents.length, 6);
  const startIndex = Math.max(0, Math.min(selectedIndex - 3, agents.length - visibleCount));
  const visibleAgents = agents.slice(startIndex, startIndex + visibleCount);

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginTop={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={grayColor}
    >
      <Box marginBottom={1} gap={2}>
        <Text color={brandColor} bold>Agents</Text>
        <Text color={grayColor} wrap="truncate">↑↓ navigate · Enter activate · Esc close</Text>
      </Box>

      {visibleAgents.map((agent, offset) => {
        const absoluteIndex = startIndex + offset;
        const isSelected = absoluteIndex === selectedIndex;
        const isActive = agent.id === activeAgentId;

        return (
          <Box
            key={agent.id}
            flexDirection="column"
            paddingX={1}
            paddingY={isSelected ? 1 : 0}
            backgroundColor={isSelected ? TUI_COLORS.surfaceRaised : undefined}
          >
            <Box gap={1}>
              <Text color={isSelected ? greenColor : grayColor} bold={isSelected}>
                {isSelected ? "❯" : " "}
              </Text>
              <Text>{agent.emoji}</Text>
              <Text color={isActive ? greenColor : TUI_COLORS.text} bold={isSelected || isActive} wrap="truncate">
                {agent.name}
              </Text>
              {isActive && <Text color={greenColor} bold>· active</Text>}
              {agent.custom && <Text color={grayColor} dimColor>custom</Text>}
            </Box>

            {isSelected && (
              <Box flexDirection="column" marginLeft={3} marginTop={0}>
                <Text color={grayColor} wrap="truncate">{agent.description}</Text>
                <Text color={grayColor} dimColor wrap="truncate">
                  └ {isActive ? "Enter to deactivate" : "Enter to activate"}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
      {agents.length > visibleCount && (
        <Box paddingX={1}>
          <Text color={grayColor} wrap="truncate">... {agents.length - visibleCount} more agents</Text>
        </Box>
      )}
    </Box>
  );
}
