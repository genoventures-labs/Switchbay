import React from "react";
import { Box, Text } from "ink";
import type { Agent } from "../../agent/agents";

type AgentDrawerProps = {
  agents: Agent[];
  activeAgentId: string | null;
  selectedIndex: number;
  visible: boolean;
};

export function AgentDrawer({ agents, activeAgentId, selectedIndex, visible }: AgentDrawerProps) {
  if (!visible) return null;

  const brandColor = "#E57373";
  const greenColor = "#00FF7F";
  const grayColor = "#707070";

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
        <Text color={brandColor} bold>ORI Agents</Text>
        <Text color={grayColor}>↑↓ navigate · Enter activate · Esc close</Text>
      </Box>

      {agents.map((agent, index) => {
        const isSelected = index === selectedIndex;
        const isActive = agent.id === activeAgentId;

        return (
          <Box
            key={agent.id}
            flexDirection="column"
            paddingX={1}
            paddingY={isSelected ? 1 : 0}
            backgroundColor={isSelected ? "#2D333B" : undefined}
          >
            <Box gap={1}>
              <Text color={isSelected ? greenColor : grayColor} bold={isSelected}>
                {isSelected ? "❯" : " "}
              </Text>
              <Text>{agent.emoji}</Text>
              <Text color={isActive ? greenColor : "white"} bold={isSelected || isActive}>
                {agent.name}
              </Text>
              {isActive && <Text color={greenColor} bold>· active</Text>}
              {agent.custom && <Text color={grayColor} dimColor>custom</Text>}
            </Box>

            {isSelected && (
              <Box flexDirection="column" marginLeft={3} marginTop={0}>
                <Text color={grayColor}>{agent.description}</Text>
                <Text color={grayColor} dimColor>
                  └ {isActive ? "Enter to deactivate" : "Enter to activate"}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
