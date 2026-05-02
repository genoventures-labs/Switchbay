import React from "react";
import { Box, Text } from "ink";
import path from "node:path";
import { existsSync } from "node:fs";
import type { SessionStatus } from "../../agent/turn-state";
import type { WorkspaceSnapshot } from "../../session/workspace";
import type { Agent } from "../../agent/agents";

type HeaderProps = {
  mode: string;
  profile: string;
  status: SessionStatus;
  workspace: WorkspaceSnapshot | null;
  activeAgentId?: string | null;
  availableAgents?: Agent[];
};

export function Header({ mode, status, workspace, activeAgentId, availableAgents = [] }: HeaderProps) {
  const cwd = workspace?.cwd ?? process.cwd();
  const project = path.basename(cwd);
  const branch = workspace?.branch ?? null;
  const dirty = workspace?.dirtyFiles.length ?? 0;
  const isThinking = status === "THINKING";
  const statusLabel = status === "DISCONNECTED" ? "ready" : status.toLowerCase();
  const branchColor = dirty > 0 ? "yellow" : "#00FF7F";
  const hasOriMd = existsSync(path.join(cwd, "ORI.md"));
  const activeAgent = activeAgentId ? availableAgents.find(a => a.id === activeAgentId) : null;

  return (
    <Box
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      borderStyle="round"
      borderColor="#707070"
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box flexDirection="column">
          <Box gap={1}>
            <Text color="#E57373" bold>ORI</Text>
            <Text color="gray">in</Text>
            <Text color="white">{project}</Text>
            {branch ? (
              <>
                <Text color="gray">·</Text>
                <Text color={branchColor}>{branch}</Text>
                {dirty > 0 ? <Text color="yellow" dimColor>{dirty} dirty</Text> : null}
              </>
            ) : null}
            {hasOriMd ? (
              <>
                <Text color="#707070">·</Text>
                <Text color="#00FF7F" dimColor>ORI.md</Text>
              </>
            ) : null}
            {activeAgent ? (
              <>
                <Text color="#707070">·</Text>
                <Text color="#E57373">{activeAgent.emoji} {activeAgent.name}</Text>
              </>
            ) : null}
          </Box>
          <Text color="#707070">{cwd}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color="#707070">{mode}</Text>
          <Text color={isThinking ? "#E57373" : "#00FF7F"} bold>
            {isThinking ? "thinking" : statusLabel}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text color="#707070">
          Ask a question, describe an edit, or use slash commands.
        </Text>
        <Text color="#707070">
          / for commands · @ for files
        </Text>
      </Box>
    </Box>
  );
}
