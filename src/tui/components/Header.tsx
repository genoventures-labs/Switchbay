import React from "react";
import { Box, Text } from "ink";
import { normalizeMode } from "../../agent/policy";

type HeaderProps = {
  mode: string;
  profile: string;
  surface: string;
};

export function Header({ mode, profile, surface }: HeaderProps) {
  return (
    <Box justifyContent="space-between" marginBottom={1} paddingX={1}>
      <Text color="white" bold>
        ORI Code
      </Text>

      <Box>
        <Text color="gray">mode </Text>
        <Text color="green">{normalizeMode(mode)}</Text>
        <Text color="gray">  surface </Text>
        <Text color="cyan">{surface}</Text>
        <Text color="gray">  profile </Text>
        <Text color="magenta">{profile}</Text>
      </Box>
    </Box>
  );
}
