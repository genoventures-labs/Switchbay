import React from "react";
import { Box, Text } from "ink";
import type { ThoughtFrame } from "../../agent/turn-state";

type ThinkingPanelProps = {
  collapsed: boolean;
  items: ThoughtFrame[];
};

function getColor(kind: ThoughtFrame["kind"]) {
  switch (kind) {
    case "goal":
      return "cyan";
    case "plan":
      return "yellow";
    case "inspect":
      return "white";
    case "capability":
      return "magenta";
    case "result":
      return "green";
    case "warning":
      return "red";
  }
}

function getLabel(item: ThoughtFrame) {
  if (item.summary.startsWith("local:")) {
    return "local";
  }

  if (item.summary.startsWith("ori:")) {
    return "ori";
  }

  return item.kind;
}

export function ThinkingPanel({ collapsed, items }: ThinkingPanelProps) {
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color="gray">
        Thinking... {collapsed ? "(Ctrl+T to expand)" : "(Ctrl+T to collapse)"}
      </Text>
      {!collapsed
        ? items.slice(0, 5).map((item) => (
            <Text key={item.id} color={getColor(item.kind)}>
              [{getLabel(item)}] {item.summary}
            </Text>
          ))
        : items[0] ? (
            <Text color={getColor(items[0].kind)}>[{getLabel(items[0])}] {items[0].summary}</Text>
          ) : null}
    </Box>
  );
}
