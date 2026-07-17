const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  cyan: "\u001b[38;5;44m",
  bright: "\u001b[38;5;51m",
  muted: "\u001b[38;5;244m",
  green: "\u001b[38;5;42m",
  yellow: "\u001b[38;5;214m",
  red: "\u001b[38;5;203m",
};

export type CliTone = "active" | "success" | "warning" | "error" | "idle";
export type CliRow = [label: string, value: string];

export function cliColorEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !("NO_COLOR" in Bun.env);
}

function paint(value: string, code: string, color = cliColorEnabled()): string {
  return color ? `${code}${value}${ANSI.reset}` : value;
}

export function cliHeader(title: string, state?: string, color = cliColorEnabled()): string {
  const suffix = state ? ` ${paint(`· ${state}`, ANSI.muted, color)}` : "";
  return `${paint("◆", ANSI.bright, color)} ${paint(title, `${ANSI.bold}`, color)}${suffix}`;
}

export function cliStatus(tone: CliTone, title: string, detail?: string, color = cliColorEnabled()): string {
  const meta = ({
    active: ["●", ANSI.cyan], success: ["✓", ANSI.green], warning: ["!", ANSI.yellow],
    error: ["×", ANSI.red], idle: ["○", ANSI.muted],
  } as Record<string, string[]>)[tone] ?? ["●", ANSI.muted];
  return `${paint(meta[0]!, meta[1]!, color)} ${paint(title, ANSI.bold, color)}${detail ? ` ${paint(`· ${detail}`, ANSI.muted, color)}` : ""}`;
}

export function cliRows(rows: CliRow[], color = cliColorEnabled()): string {
  if (!rows.length) return "";
  const width = Math.min(18, Math.max(...rows.map(([label]) => label.length)));
  return rows.map(([label, value]) => `  ${paint(label.padEnd(width), ANSI.muted, color)}  ${value}`).join("\n");
}

export function cliNext(command: string, color = cliColorEnabled()): string {
  return `  ${paint("Next", ANSI.muted, color)}  ${paint(command, ANSI.cyan, color)}`;
}

export function cliPage(input: {
  title: string; state?: string; summary?: string; rows?: CliRow[]; body?: string; next?: string; color?: boolean;
}): string {
  const color = input.color ?? cliColorEnabled();
  const blocks = [cliHeader(input.title, input.state, color)];
  if (input.summary) blocks.push(`  ${input.summary}`);
  if (input.rows?.length) blocks.push(cliRows(input.rows, color));
  if (input.body?.trim()) blocks.push(indent(cleanTerminalText(input.body.trim()), 2));
  if (input.next) blocks.push(cliNext(input.next, color));
  return blocks.join("\n\n");
}

export function cliReceipt(title: string, detail?: string, rows: CliRow[] = [], next?: string): string {
  const blocks = [cliStatus("success", title, detail)];
  if (rows.length) blocks.push(cliRows(rows));
  if (next) blocks.push(cliNext(next));
  return blocks.join("\n\n");
}

export function cliFailure(title: string, detail: string, hints: string[] = []): string {
  const rows: CliRow[] = [["Detail", detail], ...hints.map((hint, i) => [i ? "" : "Try", hint] as CliRow)];
  return `${cliStatus("error", title)}\n\n${cliRows(rows)}`;
}

export function cleanTerminalText(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => line ? `${prefix}${line}` : "").join("\n");
}

