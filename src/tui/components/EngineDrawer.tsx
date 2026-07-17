import React from "react";
import { Box, Text } from "ink";
import type { EngineManifest, EngineTool } from "../../engines/registry";
import { TUI_COLORS } from "../theme";

export type EngineDrawerItem =
  | { type: "engine"; engine: EngineManifest }
  | { type: "tool"; engine: EngineManifest; tool: EngineTool };

type EngineDrawerProps = {
  items: EngineDrawerItem[];
  selectedIndex: number;
  visible: boolean;
};

export function flattenEngineDrawerItems(engines: EngineManifest[]): EngineDrawerItem[] {
  return engines.flatMap((engine) => [
    { type: "engine" as const, engine },
    ...engine.tools.map((tool) => ({ type: "tool" as const, engine, tool })),
  ]);
}

export function EngineDrawer({ items, selectedIndex, visible }: EngineDrawerProps) {
  if (!visible) return null;

  const visibleCount = Math.min(items.length, 12);
  const startIndex = Math.max(0, Math.min(selectedIndex - 5, items.length - visibleCount));
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
        <Text color={TUI_COLORS.accentBright} bold>Engines</Text>
        <Text color={TUI_COLORS.muted} wrap="truncate">↑↓ browse · Enter insert tool prompt · Esc close</Text>
      </Box>

      {visibleItems.length > 0 ? (
        visibleItems.map((item, offset) => {
          const absoluteIndex = startIndex + offset;
          const selected = absoluteIndex === selectedIndex;
          if (item.type === "engine") {
            return (
              <Box
                key={`engine:${item.engine.id}`}
                flexDirection="column"
                paddingX={1}
                backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
              >
                <Box gap={1}>
                  <Text color={selected ? TUI_COLORS.accent : TUI_COLORS.muted} bold={selected}>
                    {selected ? ">" : " "}
                  </Text>
                  <Text color={TUI_COLORS.accentBright} bold wrap="truncate">{item.engine.name}</Text>
                  <Text color={TUI_COLORS.muted} wrap="truncate">[{item.engine.id}]</Text>
                  <Text color={TUI_COLORS.muted} wrap="truncate">{item.engine.tools.length} tools</Text>
                </Box>
                {selected ? (
                  <Box paddingLeft={2}>
                    <Text color={TUI_COLORS.muted} wrap="truncate">{item.engine.description || "No description."}</Text>
                  </Box>
                ) : null}
              </Box>
            );
          }

          return (
            <Box
              key={`tool:${item.engine.id}:${item.tool.name}`}
              flexDirection="column"
              paddingX={1}
              backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? TUI_COLORS.accent : TUI_COLORS.muted} bold={selected}>
                  {selected ? ">" : " "}
                </Text>
                <Text color={TUI_COLORS.muted}>└</Text>
                <Text color={selected ? TUI_COLORS.text : TUI_COLORS.muted} bold={selected} wrap="truncate">
                  {item.tool.name}
                </Text>
                {item.tool.required?.length ? (
                  <Text color={TUI_COLORS.muted} wrap="truncate">req: {item.tool.required.join(", ")}</Text>
                ) : null}
              </Box>
              {selected ? (
                <Box paddingLeft={4}>
                  <Text color={TUI_COLORS.muted} wrap="truncate">{item.tool.description || "No description."}</Text>
                </Box>
              ) : null}
            </Box>
          );
        })
      ) : (
        <Text color={TUI_COLORS.muted}>No engines registered.</Text>
      )}

      {items.length > visibleCount ? (
        <Box marginTop={1} paddingX={1}>
          <Text color={TUI_COLORS.muted} wrap="truncate">... {items.length - visibleCount} more engine entries</Text>
        </Box>
      ) : null}
    </Box>
  );
}
