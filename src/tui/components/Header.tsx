import React from "react";
import { Box, Text } from "ink";
import path from "node:path";
import { existsSync, readFileSync as readFileSyncNode } from "node:fs";
import { existingProjectContextPath, existingWorkspaceDataPath } from "../../config/paths";
import type { SessionStatus } from "../../agent/turn-state";
import type { WorkspaceSnapshot } from "../../session/workspace";
import type { Agent } from "../../agent/agents";
import { TUI_COLORS } from "../theme";

type HeaderProps = {
  lane?: string;
  mode: string;
  profile: string;
  status: SessionStatus;
  terminalWidth?: number;
  workspace: WorkspaceSnapshot | null;
  activeAgentId?: string | null;
  availableAgents?: Agent[];
};

export function Header({ lane = "Cloud", mode, status, terminalWidth = 120, workspace, activeAgentId, availableAgents = [] }: HeaderProps) {
  const cwd = workspace?.cwd ?? process.cwd();
  const project = path.basename(cwd);
  const branch = workspace?.branch ?? null;
  const dirty = workspace?.dirtyFiles.length ?? 0;
  const isThinking = status === "THINKING";
  const statusLabel = status === "DISCONNECTED" ? "ready" : status.toLowerCase();
  const branchColor = dirty > 0 ? TUI_COLORS.accentBright : TUI_COLORS.accent;
  const hasProjectContext = Boolean(existingProjectContextPath(cwd));
  const hasMemory = existsSync(existingWorkspaceDataPath(cwd, "memory.md"));
  const pinCount = (() => {
    try {
      const p = existingWorkspaceDataPath(cwd, "pins.json");
      if (!existsSync(p)) return 0;
      return (JSON.parse(readFileSyncNode(p, "utf-8")) as string[]).length;
    } catch { return 0; }
  })();
  const activeAgent = activeAgentId ? availableAgents.find(a => a.id === activeAgentId) : null;
  const maxCwdLength = Math.max(28, Math.min(terminalWidth - 44, 92));
  const displayCwd = cwd.length > maxCwdLength
    ? `...${cwd.slice(-(maxCwdLength - 3))}`
    : cwd;

  return (
    <Box
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      borderStyle="round"
      borderColor={TUI_COLORS.surfaceRaised}
      backgroundColor={TUI_COLORS.baseDeep}
    >
      <Box justifyContent="space-between">
        <Box gap={1} flexShrink={1}>
          <Text color={TUI_COLORS.accentBright} bold>Switchbay</Text>
          <Text color={TUI_COLORS.muted}>in</Text>
          <Text color={TUI_COLORS.text}>{project}</Text>
          {branch ? (
            <>
              <Text color={TUI_COLORS.muted}>·</Text>
              <Text color={branchColor}>{branch}</Text>
              {dirty > 0 ? <Text color={TUI_COLORS.accentBright} dimColor>{dirty} dirty</Text> : null}
            </>
          ) : null}
          {hasProjectContext ? <Text color={TUI_COLORS.accent} dimColor>context</Text> : null}
          {hasMemory ? <Text color={TUI_COLORS.accent} dimColor>mem</Text> : null}
          {pinCount > 0 ? <Text color={TUI_COLORS.accent} dimColor>{pinCount} pinned</Text> : null}
          {activeAgent ? <Text color={TUI_COLORS.accentBright}>{activeAgent.emoji} {activeAgent.name}</Text> : null}
        </Box>
        <Box gap={1} flexShrink={0}>
          <Text color={TUI_COLORS.muted}>{lane}</Text>
          <Text color={TUI_COLORS.muted}>·</Text>
          <Text color={TUI_COLORS.muted}>{mode}</Text>
          <Text color={TUI_COLORS.muted}>·</Text>
          <Text color={isThinking ? TUI_COLORS.accentBright : TUI_COLORS.accent} bold>
            {isThinking ? "thinking" : statusLabel}
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Text color={TUI_COLORS.muted}>{displayCwd}</Text>
        <Box gap={1} flexShrink={0}>
          <Text color={TUI_COLORS.muted}>/ commands</Text>
          <Text color={TUI_COLORS.muted}>·</Text>
          <Text color={TUI_COLORS.muted}>@ files</Text>
        </Box>
      </Box>
      <Box>
        <Text color={TUI_COLORS.muted}>
          Talk to Sway, route a task, inspect the repo, or call a Switchbay lane.
        </Text>
      </Box>
    </Box>
  );
}
