import { expect, test } from "bun:test";
import { cliFailure, cliPage, cliReceipt, cleanTerminalText } from "./presentation";
import { renderCliHelp } from "./help";

test("CLI pages use the shared OS shell grammar", () => {
  expect(cliPage({ title: "Engine Bay", state: "Ready", rows: [["Engines", "12"]], next: "switchbay engines list", color: false }))
    .toBe("◆ Engine Bay · Ready\n\n  Engines  12\n\n  Next  switchbay engines list");
});

test("receipts and failures use consistent state markers", () => {
  expect(cliReceipt("Daily Board", "Task added")).toStartWith("✓ Daily Board · Task added");
  expect(cliFailure("MCP Bridge", "Config missing", ["switchbay mcp init"])).toContain("× MCP Bridge");
});

test("terminal text removes chat markdown", () => {
  expect(cleanTerminalText("**Status**\nUse `switchbay models`.")).toBe("Status\nUse switchbay models.");
});

test("help is grouped and pipe-safe", () => {
  const output = renderCliHelp(false);
  expect(output).toContain("◆ Switchbay · Command Center · Local AI Work System");
  expect(output).toContain("WORKSPACE");
  expect(output).toContain("RUNTIME");
  expect(output).not.toContain("\u001b[");
});
