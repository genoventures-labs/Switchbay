import { ANSI_COLORS as CLR } from "../tui/theme";

export type ListColumn = { key: string; label: string; width: number };
export type ListRow = Record<string, string | number | null | undefined>;

export function renderCliList(input: {
  title: string;
  count: number;
  noun: string;
  summary?: string;
  columns: ListColumn[];
  rows: ListRow[];
  empty?: string;
  hint?: string;
  color?: boolean;
}): string {
  const color = input.color ?? Boolean(process.stdout.isTTY);
  const paint = (value: string, code: string) => color ? `${code}${value}${CLR.reset}` : value;
  const plural = input.count === 1 ? input.noun : `${input.noun}s`;
  const lines = [
    `${paint("◆", CLR.accentBright)} ${paint(input.title, `${CLR.bold}${CLR.text}`)} ${paint(`· ${input.summary ?? `${input.count} ${plural}`}`, CLR.muted)}`,
  ];

  if (!input.rows.length) {
    lines.push("", `  ${paint(input.empty ?? `No ${plural} found.`, CLR.muted)}`);
  } else {
    lines.push("", `  ${input.columns.map((column) => pad(column.label.toUpperCase(), column.width)).join("  ").trimEnd()}`);
    lines.push(`  ${input.columns.map((column) => paint("─".repeat(column.width), CLR.muted)).join("  ")}`);
    for (const row of input.rows) {
      lines.push(`  ${input.columns.map((column, index) => {
        const value = pad(String(row[column.key] ?? "—"), column.width);
        return index === 0 ? paint(value, CLR.accent) : value;
      }).join("  ").trimEnd()}`);
    }
  }

  if (input.hint) lines.push("", `  ${paint(input.hint, CLR.muted)}`);
  return lines.join("\n");
}

function pad(value: string, width: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const clipped = compact.length > width ? `${compact.slice(0, Math.max(1, width - 1))}…` : compact;
  return clipped.padEnd(width, " ");
}
