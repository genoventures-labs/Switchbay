import React from "react";
import { Box, Text } from "ink";
import type { ToolboxSkill } from "../../toolbox/hub";
import { TUI_COLORS } from "../theme";

type SkillDrawerProps = {
  items: ToolboxSkill[];
  notice?: string | null;
  selectedIndex: number;
  visible: boolean;
};

export function SkillDrawer({ items, notice, selectedIndex, visible }: SkillDrawerProps) {
  if (!visible) return null;

  const visibleCount = Math.min(items.length, 10);
  const startIndex = Math.max(0, Math.min(selectedIndex - 4, items.length - visibleCount));
  const visibleItems = items.slice(startIndex, startIndex + visibleCount);

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginTop={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={TUI_COLORS.muted}
    >
      <Box marginBottom={1} gap={2}>
        <Text color={TUI_COLORS.accentBright} bold>Skills</Text>
        <Text color={TUI_COLORS.muted}>↑↓ browse · Enter insert · Esc close</Text>
      </Box>

      {notice ? (
        <Box marginBottom={1} paddingX={1}>
          <Text color={TUI_COLORS.accentBright}>{notice}</Text>
        </Box>
      ) : null}

      {visibleItems.length > 0 ? (
        visibleItems.map((skill, offset) => {
          const absoluteIndex = startIndex + offset;
          const selected = absoluteIndex === selectedIndex;
          const tags = [...skill.tags, ...skill.triggers].slice(0, 4);

          return (
            <Box
              key={`${skill.source}:${skill.id}`}
              flexDirection="column"
              paddingX={1}
              backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? TUI_COLORS.accent : TUI_COLORS.muted} bold={selected}>
                  {selected ? ">" : " "}
                </Text>
                <Text color={TUI_COLORS.accentBright} bold={selected}>
                  {skill.name}
                </Text>
                <Text color={TUI_COLORS.muted}>[{skill.id}]</Text>
                <Text color={TUI_COLORS.muted}>{skill.source}</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color={selected ? TUI_COLORS.text : TUI_COLORS.muted}>
                  {skill.description || "No description."}
                </Text>
              </Box>
              {selected ? (
                <Box flexDirection="column" paddingLeft={2}>
                  <Text color={TUI_COLORS.muted}>
                    Agents: {skill.agents.join(", ") || "any"} · Languages: {skill.languages.join(", ") || "any"}
                  </Text>
                  {tags.length ? (
                    <Text color={TUI_COLORS.muted}>Signals: {tags.join(", ")}</Text>
                  ) : null}
                </Box>
              ) : null}
            </Box>
          );
        })
      ) : (
        <Text color={TUI_COLORS.muted}>No Toolbox skills found. Run /skills sync.</Text>
      )}

      {items.length > visibleCount ? (
        <Box marginTop={1} paddingX={1}>
          <Text color={TUI_COLORS.muted}>... {items.length - visibleCount} more skills</Text>
        </Box>
      ) : null}
    </Box>
  );
}
