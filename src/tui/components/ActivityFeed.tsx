import React from "react";
import { Box, Text } from "ink";
import type { ActivityEvent } from "../../agent/turn-state";
import type { PatchPreview } from "../../tools/patch";

type ActivityFeedProps = {
  patchPreview: PatchPreview | null;
  items: ActivityEvent[];
};

function getActivityColor(kind: ActivityEvent["kind"]) {
  switch (kind) {
    case "status":
      return "green";
    case "tool":
      return "yellow";
    case "error":
      return "red";
    default:
      return "white";
  }
}

export function ActivityFeed({ items, patchPreview }: ActivityFeedProps) {
  return (
    <Box
      flexDirection="column"
      paddingX={1}
    >
      <Text color="gray">activity</Text>
      {items.slice(0, 4).map((activity) => (
        <Text key={activity.id} color={getActivityColor(activity.kind)}>
          {activity.kind} · {activity.message}
        </Text>
      ))}
      {patchPreview ? (
        <>
          <Text color="gray">patch</Text>
          {patchPreview.diff
            .split("\n")
            .slice(0, 12)
            .map((line, index) => (
              <Text
                key={`${patchPreview.targetPath}-${index}`}
                color={
                  line.startsWith("+")
                    ? "green"
                    : line.startsWith("-")
                      ? "red"
                      : "white"
                }
              >
                {line}
              </Text>
            ))}
        </>
      ) : null}
    </Box>
  );
}
