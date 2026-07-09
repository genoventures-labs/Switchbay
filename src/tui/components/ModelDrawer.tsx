import React from "react";
import { Box, Text } from "ink";
import type { RuntimeModelOption } from "../../runtime/models";
import { TUI_COLORS } from "../theme";

type ModelDrawerProps = {
  activeModel: RuntimeModelOption | null;
  items: RuntimeModelOption[];
  notice?: string | null;
  selectedIndex: number;
  visible: boolean;
};

export function ModelDrawer({
  activeModel,
  items,
  notice,
  selectedIndex,
  visible,
}: ModelDrawerProps) {
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
        <Text color={TUI_COLORS.accentBright} bold>Models</Text>
        <Text color={TUI_COLORS.muted}>↑↓ browse · Enter select · Esc close</Text>
      </Box>

      {activeModel ? (
        <Box marginBottom={1} paddingX={1}>
          <Text color={TUI_COLORS.muted}>Active: </Text>
          <Text color={TUI_COLORS.accent}>{activeModel.provider}</Text>
          <Text color={TUI_COLORS.muted}> · </Text>
          <Text color={TUI_COLORS.text}>{activeModel.id}</Text>
        </Box>
      ) : null}

      {notice ? (
        <Box marginBottom={1} paddingX={1}>
          <Text color={TUI_COLORS.accentBright}>{notice}</Text>
        </Box>
      ) : null}

      {visibleItems.length > 0 ? (
        visibleItems.map((item, offset) => {
          const absoluteIndex = startIndex + offset;
          const selected = absoluteIndex === selectedIndex;
          const active = activeModel?.id === item.id && activeModel.provider === item.provider;

          return (
            <Box
              key={`${item.provider}:${item.id}`}
              flexDirection="column"
              paddingX={1}
              backgroundColor={selected ? TUI_COLORS.surfaceRaised : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? TUI_COLORS.accent : TUI_COLORS.muted} bold={selected}>
                  {selected ? ">" : " "}
                </Text>
                <Text color={active ? TUI_COLORS.accentBright : TUI_COLORS.text} bold={selected || active}>
                  {item.label}
                </Text>
                <Text color={TUI_COLORS.muted}>[{item.provider}]</Text>
                {active ? <Text color={TUI_COLORS.accent}>active</Text> : null}
              </Box>
              {selected ? (
                <Box paddingLeft={2}>
                  <Text color={TUI_COLORS.muted}>
                    {item.provider === "ollama"
                      ? "Ollama local lane"
                      : item.lane === "local"
                      ? "LM Studio local lane"
                      : item.lane === "local-mcp"
                        ? "LM Studio native MCP lane"
                        : item.lane === "cloud-mcp"
                          ? "Cloud + Switchbay MCP bridge"
                          : "Cloud lane"} · {item.source}
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })
      ) : (
        <Text color={TUI_COLORS.muted}>No models available.</Text>
      )}

      {items.length > visibleCount ? (
        <Box marginTop={1} paddingX={1}>
          <Text color={TUI_COLORS.muted}>... {items.length - visibleCount} more models</Text>
        </Box>
      ) : null}
    </Box>
  );
}
