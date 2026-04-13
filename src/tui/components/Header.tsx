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

  return (
    <Box
      paddingX={2}
      paddingY={0}
      justifyContent="space-between"
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom={true}
      borderColor="gray"
    >
      <Box gap={1}>
        <Text color="cyan" bold>ori</Text>
        <Text color="gray">·</Text>
        <Text color="white" bold>{project}</Text>
        {branch ? (
          <>
            <Text color="gray">·</Text>
            <Text color={dirty > 0 ? "yellow" : "green"}>{branch}</Text>
            {dirty > 0 && <Text color="yellow" dimColor>{dirty}~</Text>}
          </>
        ) : null}
      </Box>
      <Box gap={1}>
        <Text color="gray" dimColor>{mode}</Text>
        <Text color={isThinking ? "yellow" : "green"}>
          {isThinking ? "⠿" : "●"}
        </Text>
      </Box>
    </Box>
  );
}
