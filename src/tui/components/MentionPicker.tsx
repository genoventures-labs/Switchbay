import React from "react";
import { Box, Text } from "ink";
import type { MentionCandidate } from "../../tools/mentions";
import { TUI_COLORS } from "../theme";

type MentionPickerProps = {
  candidates: MentionCandidate[];
  selectedIndex: number;
  visible: boolean;
};

export function MentionPicker({ candidates, selectedIndex, visible }: MentionPickerProps) {
  if (!visible || candidates.length === 0) return null;

  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;

  const visible_count = Math.min(candidates.length, 8);
  const startIndex = Math.max(0, Math.min(selectedIndex - 3, candidates.length - visible_count));
  const visibleCandidates = candidates.slice(startIndex, startIndex + visible_count);

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
        <Text color={brandColor} bold>Files</Text>
        <Text color={grayColor}> · Use arrow keys to select</Text>
      </Box>

      {visibleCandidates.map((candidate, i) => {
        const absoluteIndex = startIndex + i;
        const isSelected = absoluteIndex === selectedIndex;
        return (
          <Box 
            key={candidate.value} 
            gap={1} 
            paddingX={1}
            backgroundColor={isSelected ? TUI_COLORS.surfaceRaised : undefined}
          >
            <Text color={isSelected ? greenColor : grayColor} bold={isSelected}>
              {isSelected ? "❯" : " "}
            </Text>
            <Text color={TUI_COLORS.text} bold={isSelected}>
              {candidate.label}{candidate.isDir ? "/" : ""}
            </Text>
            {isSelected && <Text color={grayColor}>  - insert path</Text>}
          </Box>
        );
      })}
      
      {candidates.length > visible_count && (
        <Box marginTop={1} paddingX={1}>
          <Text color={grayColor}>  ... {candidates.length - visible_count} more files</Text>
        </Box>
      )}
    </Box>
  );
}
