import React from "react";
import { Box, Text } from "ink";
import { TUI_COLORS } from "../theme";

type WelcomeBoardProps = {
  appName: string;
  lane: string;
  version: string;
  cwd: string;
  terminalWidth: number;
};

const SWITCHBAY_LOGO = [
  "███████╗██╗    ██╗██████╗ ",
  "██╔════╝██║    ██║██╔══██╗",
  "███████╗██║ █╗ ██║██████╔╝",
  "╚════██║██║███╗██║██╔══██╗",
  "███████║╚███╔███╔╝██████╔╝",
  "╚══════╝ ╚══╝╚══╝ ╚═════╝ ",
];

const COMPACT_LOGO = [
  " ╭────╮",
  " │ SWB│",
  " ╰────╯",
];

export function WelcomeBoard({ appName, lane, version, cwd, terminalWidth }: WelcomeBoardProps) {
  const brandColor = TUI_COLORS.accentBright;
  const grayColor = TUI_COLORS.muted;
  const dimColor = TUI_COLORS.surfaceRaised;

  const isWide = terminalWidth >= 80;
  const isMid = terminalWidth >= 55;

  // truncate cwd to fit
  const maxCwdLen = isWide ? 42 : 28;
  const displayCwd = cwd.length > maxCwdLen
    ? "…" + cwd.slice(-(maxCwdLen - 1))
    : cwd;

  if (!isMid) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {COMPACT_LOGO.map((line, i) => (
          <Text key={i} color={brandColor}>{line}</Text>
        ))}
        <Text color={grayColor}>{appName} v{version} · {lane}</Text>
        <Text color={dimColor}>models ready</Text>
        <Text color={dimColor}>{displayCwd}</Text>
        <Box marginTop={1}>
          <Text color={dimColor}>? shortcuts · / commands</Text>
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
          {SWITCHBAY_LOGO.map((line, i) => (
            <Text key={i} color={brandColor}>{line}</Text>
          ))}
          <Box marginTop={0}>
            <Text color={dimColor}>{"          "}cloud/local + MCP bridge</Text>
          </Box>
        </Box>

        {/* Info panel */}
        {isWide && (
          <Box flexDirection="column" justifyContent="center" paddingTop={1}>
            <Box gap={2} marginBottom={1}>
              <Text color={grayColor}>v{version}</Text>
              <Text color={dimColor}>·</Text>
              <Text color={TUI_COLORS.text}>{lane}</Text>
            </Box>
            <Text color={grayColor}>{appName}</Text>
            <Text color={dimColor}>terminal-first AI coding workbench</Text>
            <Text color={dimColor}>cloud/local models, Switchbay MCP bridge</Text>
            <Text color={dimColor}>address GPT, Claude, Gemini, or use Auto</Text>
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
        <Text color={dimColor}><Text color={grayColor}>?</Text> shortcuts</Text>
        <Text color={dimColor}><Text color={grayColor}>/edit</Text> file</Text>
        <Text color={dimColor}><Text color={grayColor}>@file</Text> context</Text>
        <Text color={dimColor}><Text color={grayColor}>/agent</Text> specialist</Text>
      </Box>
    </Box>
  );
}
