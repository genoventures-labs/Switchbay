import React from "react";
import { Box, Text } from "ink";
import type { MentionCandidate } from "../../tools/mentions";

type MentionPickerProps = {
  candidates: MentionCandidate[];
  selectedIndex: number;
  visible: boolean;
};

export function MentionPicker({ candidates, selectedIndex, visible }: MentionPickerProps) {
  if (!visible || candidates.length === 0) return null;

  const visible_count = Math.min(candidates.length, 8);
  const startIndex = Math.max(0, Math.min(selectedIndex - 3, candidates.length - visible_count));
  const visibleCandidates = candidates.slice(startIndex, startIndex + visible_count);

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={0}
      marginBottom={0}
      borderStyle="round"
      borderColor="gray"
    >
      <Text color="cyan" bold>Files</Text>
      <Text color="#707070">Pick a path to insert into the prompt.</Text>
      {visibleCandidates.map((candidate, i) => {
        const absoluteIndex = startIndex + i;
        const isSelected = absoluteIndex === selectedIndex;
        return (
          <Box key={candidate.value} gap={1} marginTop={1}>
            <Text color={isSelected ? "cyan" : "gray"} bold={isSelected}>
              {isSelected ? "❯" : " "}
            </Text>
            <Text color={isSelected ? "white" : "gray"}>
              {candidate.isDir ? (
                <Text color={isSelected ? "cyan" : "gray"}>{candidate.label}/</Text>
              ) : (
                candidate.label
              )}
            </Text>
          </Box>
        );
      })}
      {candidates.length > visible_count && (
        <Text color="#707070">  +{candidates.length - visible_count} more</Text>
      )}
    </Box>
  );
}
