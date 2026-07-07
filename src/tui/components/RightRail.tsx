import React from "react";
import { Box, Text } from "ink";
import type { Agent } from "../../agent/agents";
import type { ActivityEvent, SessionStatus, ThoughtFrame, TranscriptEntry } from "../../agent/turn-state";
import type { WorkspaceSnapshot } from "../../session/workspace";
import { TUI_COLORS } from "../theme";

type RightRailProps = {
  activeAgentId?: string | null;
  availableAgents?: Agent[];
  changedFiles: string[];
  collapsedReason?: string | null;
  mode: string;
  recentActivity: ActivityEvent[];
  runtimeBadge: string;
  status: SessionStatus;
  thoughts: ThoughtFrame[];
  transcript: TranscriptEntry[];
  workspace: WorkspaceSnapshot | null;
  width: number;
};

export function RightRail({
  activeAgentId,
  availableAgents = [],
  changedFiles,
  collapsedReason = null,
  mode,
  recentActivity,
  runtimeBadge,
  status,
  thoughts,
  transcript,
  workspace,
  width,
}: RightRailProps) {
  const activeAgent = activeAgentId ? availableAgents.find((agent) => agent.id === activeAgentId) : null;
  const toolEntries = transcript
    .filter((entry) => entry.kind === "tool" && (entry.body || entry.title))
    .slice(-8)
    .reverse();
  const latestThoughts = thoughts.slice(0, 5);
  const dirty = workspace?.dirtyFiles.length ?? 0;
  const branch = workspace?.branch ?? "no branch";

  return (
    <Box width={width} flexDirection="column" paddingLeft={1} gap={1}>
      <RailPanel title="Runtime" minHeight={7}>
        <Line label="Lane" value={runtimeBadge} accent />
        <Line label="Mode" value={mode} />
        <Line label="Status" value={status.toLowerCase()} accent={status === "THINKING"} />
        {activeAgent ? <Line label="Agent" value={`${activeAgent.emoji} ${activeAgent.name}`} /> : null}
        {collapsedReason ? <Text color={TUI_COLORS.muted}>{collapsedReason}</Text> : null}
      </RailPanel>

      <RailPanel title="Agent Feed" flexGrow={1}>
        {toolEntries.length ? (
          toolEntries.map((entry) => (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Text color={entry.tone === "error" ? TUI_COLORS.accentBright : TUI_COLORS.accent}>
                {entry.tone === "error" ? "x" : "↳"} <Text color={TUI_COLORS.text}>{truncate(entry.body || entry.title, width - 6)}</Text>
              </Text>
            </Box>
          ))
        ) : latestThoughts.length ? (
          latestThoughts.map((thought) => (
            <Box key={thought.id} marginBottom={1}>
              <Text color={TUI_COLORS.muted}>• {truncate(thought.summary, width - 5)}</Text>
            </Box>
          ))
        ) : (
          <Text color={TUI_COLORS.muted}>No activity yet.</Text>
        )}
      </RailPanel>

      <RailPanel title="Workspace" minHeight={8}>
        <Line label="Branch" value={branch} />
        <Line label="Dirty" value={`${dirty}`} accent={dirty > 0} />
        {changedFiles.slice(-4).map((file) => (
          <Text key={file} color={TUI_COLORS.muted}>• {truncate(file, width - 5)}</Text>
        ))}
        {!changedFiles.length ? <Text color={TUI_COLORS.muted}>No tracked session edits.</Text> : null}
        {recentActivity.slice(0, 2).map((event) => (
          <Text key={event.id} color={TUI_COLORS.muted}>• {truncate(event.message, width - 5)}</Text>
        ))}
      </RailPanel>
    </Box>
  );
}

function RailPanel({
  children,
  flexGrow,
  minHeight,
  title,
}: {
  children: React.ReactNode;
  flexGrow?: number;
  minHeight?: number;
  title: string;
}) {
  return (
    <Box
      borderStyle="round"
      borderColor={TUI_COLORS.surfaceRaised}
      backgroundColor={TUI_COLORS.baseDeep}
      flexDirection="column"
      flexGrow={flexGrow}
      minHeight={minHeight}
      paddingX={1}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text color={TUI_COLORS.accentBright} bold>{title}</Text>
      </Box>
      {children}
    </Box>
  );
}

function Line({ accent = false, label, value }: { accent?: boolean; label: string; value: string }) {
  return (
    <Box gap={1}>
      <Text color={TUI_COLORS.muted}>{label}:</Text>
      <Text color={accent ? TUI_COLORS.accent : TUI_COLORS.text}>{value}</Text>
    </Box>
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
