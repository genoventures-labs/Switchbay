const BLOCKS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  if (!values.length) return "";
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => BLOCKS[0]).join("");
  return values.map(value => BLOCKS[Math.min(BLOCKS.length - 1, Math.round((value / max) * (BLOCKS.length - 1)))]).join("");
}

export function barChart(rows: Array<{ label: string; value: number }>, width = 22): string {
  if (!rows.length) return "No data.";
  const max = Math.max(1, ...rows.map(row => row.value));
  const labelWidth = Math.max(...rows.map(row => row.label.length));
  return rows.map(row => {
    const size = row.value <= 0 ? 0 : Math.max(1, Math.round((row.value / max) * width));
    return `${row.label.padEnd(labelWidth)}  ${"█".repeat(size)}${"░".repeat(width - size)}  ${row.value}`;
  }).join("\n");
}

export function flowGraph(nodes: Array<{ label: string; detail?: string; tone?: "ok" | "error" | "warning" }>): string {
  return nodes.flatMap((node, index) => {
    const icon = node.tone === "error" ? "✗" : node.tone === "warning" ? "!" : node.tone === "ok" ? "✓" : "◆";
    const lines = [`${icon} ${node.label}${node.detail ? ` · ${node.detail}` : ""}`];
    if (index < nodes.length - 1) lines.push("│", "▼");
    return lines;
  }).join("\n");
}
