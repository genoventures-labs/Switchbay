import React from "react";
import { Box, Text } from "ink";

type WelcomeBoardProps = {
  version: string;
  user: string;
  email: string;
  model: string;
  cwd: string;
  terminalWidth: number;
};

const ORI_LOGO = [
  " ██████╗ ██████╗ ██╗",
  "██╔═══██╗██╔══██╗██║",
  "██║   ██║██████╔╝██║",
  "██║   ██║██╔══██╗██║",
  "╚██████╔╝██║  ██║██║",
  " ╚═════╝ ╚═╝  ╚═╝╚═╝",
];

// Compact single-line O for narrow terminals
const O_COMPACT = [
  " ╭───╮",
  " │ O │",
  " ╰───╯",
];

export function WelcomeBoard({ version, user, email, model, cwd, terminalWidth }: WelcomeBoardProps) {
  const brandColor = "#E57373";
  const grayColor = "#707070";
  const dimColor = "#505050";
  const greenColor = "#00FF7F";

  const isWide = terminalWidth >= 80;
  const isMid = terminalWidth >= 55;

  // truncate cwd to fit
  const maxCwdLen = isWide ? 42 : 28;
  const displayCwd = cwd.length > maxCwdLen
    ? "…" + cwd.slice(-(maxCwdLen - 1))
    : cwd;

  if (!isMid) {
    // Narrow: compact O + one-liner info
    return (
      <Box flexDirection="column" marginBottom={1}>
        {O_COMPACT.map((line, i) => (
          <Text key={i} color={brandColor}>{line}</Text>
        ))}
        <Text color={grayColor}>ORI Code v{version} · {model}</Text>
        <Text color={dimColor}>{displayCwd}</Text>
        <Box marginTop={1}>
          <Text color={dimColor}>/help for commands</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top rule */}
      <Box marginBottom={1}>
        <Text color={dimColor}>{"─".repeat(Math.min(terminalWidth - 2, 70))}</Text>
      </Box>

      {/* Logo + info row */}
      <Box flexDirection="row" gap={4}>

        {/* ASCII logo */}
        <Box flexDirection="column">
          {ORI_LOGO.map((line, i) => (
            <Text key={i} color={brandColor}>{line}</Text>
          ))}
          <Box marginTop={0}>
            <Text color={dimColor}>{"          "}code</Text>
          </Box>
        </Box>

        {/* Info panel */}
        {isWide && (
          <Box flexDirection="column" justifyContent="center" paddingTop={1}>
            <Box gap={2} marginBottom={1}>
              <Text color={grayColor}>v{version}</Text>
              <Text color={dimColor}>·</Text>
              <Text color="white">{model}</Text>
            </Box>
            <Text color={grayColor}>{user}</Text>
            <Text color={dimColor}>{email}</Text>
            <Box marginTop={1}>
              <Text color={dimColor}>{displayCwd}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Bottom rule + hints */}
      <Box marginTop={1} marginBottom={0}>
        <Text color={dimColor}>{"─".repeat(Math.min(terminalWidth - 2, 70))}</Text>
      </Box>
      <Box marginTop={1} gap={3} flexWrap="wrap">
        <Text color={dimColor}><Text color={grayColor}>/help</Text> commands</Text>
        <Text color={dimColor}><Text color={grayColor}>/edit</Text> file</Text>
        <Text color={dimColor}><Text color={grayColor}>@file</Text> context</Text>
        <Text color={dimColor}><Text color={grayColor}>/mode</Text> debug·design</Text>
      </Box>
    </Box>
  );
}
