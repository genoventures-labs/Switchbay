export const TUI_COLORS = {
  base: "#0A0F12",
  baseDeep: "#080D10",
  surface: "#151C21",
  surfaceAlt: "#171B1C",
  surfaceRaised: "#1E252A",
  text: "#E6E8EA",
  muted: "#7F878D",
  accent: "#11A79B",
  accentBright: "#29BEB1",
} as const;

export const ANSI_COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  accent: "\x1b[38;2;17;167;155m",
  accentBright: "\x1b[38;2;41;190;177m",
  muted: "\x1b[38;2;127;135;141m",
  text: "\x1b[38;2;230;232;234m",
  error: "\x1b[38;2;239;68;68m",
} as const;
