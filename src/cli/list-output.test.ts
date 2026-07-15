import { expect, test } from "bun:test";
import { renderCliList } from "./list-output";

test("CLI lists share a compact aligned layout", () => {
  const output = renderCliList({
    title: "Engines",
    count: 1,
    noun: "engine",
    summary: "1 registered",
    columns: [{ key: "id", label: "ID", width: 10 }, { key: "tools", label: "Tools", width: 8 }],
    rows: [{ id: "creative", tools: 12 }],
    hint: "Inspect: switchbay engines read <id>",
    color: false,
  });
  expect(output).toContain("◆ Engines · 1 registered");
  expect(output).toContain("ID          TOOLS");
  expect(output).toContain("creative    12");
});
