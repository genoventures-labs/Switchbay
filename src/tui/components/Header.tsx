import React from "react";
import { Box, Text } from "ink";
import path from "node:path";
import type { SessionStatus } from "../../agent/turn-state";
import type { WorkspaceSnapshot } from "../../session/workspace";

type HeaderProps = {
  mode: string;
  profile: string;
  status: SessionStatus;
  workspace: WorkspaceSnapshot | null;
};

export function Header({ mode, status, workspace }: HeaderProps) {
  const cwd = workspace?.cwd ?? process.cwd();
  const project = path.basename(cwd);
  const branch = workspace?.branch ?? null;
  const dirty = workspace?.dirtyFiles.length ?? 0;
  const isThinking = status === "THINKING";
  const statusLabel = status === "DISCONNECTED" ? "ready" : status.toLowerCase();
  const branchColor = dirty > 0 ? "yellow" : "green";

  return (
    <Box
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box flexDirection="column">
          <Box gap={1}>
            <Text color="cyan" bold>ORI</Text>
            <Text color="gray">in</Text>
            <Text color="white" bold>{project}</Text>
            {branch ? (
              <>
                <Text color="gray">·</Text>
                <Text color={branchColor}>{branch}</Text>
                {dirty > 0 ? <Text color="yellow" dimColor>{dirty} dirty</Text> : null}
              </>
            ) : null}
          </Box>
          <Text color="gray" dimColor>{cwd}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color="gray" dimColor>{mode}</Text>
          <Text color={isThinking ? "yellow" : "green"} bold>
            {isThinking ? "thinking" : statusLabel}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text color="gray" dimColor>
          Ask a question, describe an edit, or use slash commands.
        </Text>
        <Text color="gray" dimColor>
          / for commands · @ for files
        </Text>
      </Box>
    </Box>
  );
}
