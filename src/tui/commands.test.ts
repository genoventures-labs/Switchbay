import { expect, test } from "bun:test";
import { getCommandMatches, SLASH_COMMANDS } from "./commands";

test("command palette lists only implemented command families", () => {
  const commands = SLASH_COMMANDS.map((item) => item.command);

  expect(commands).toContain("/agent");
  expect(commands).toContain("/review");
  expect(commands).toContain("/checkpoint");
  expect(commands).toContain("/edit");
  expect(commands).toContain("/engines");
  expect(commands).toContain("/engine-bay");
  expect(commands).toContain("/creative");

  expect(commands).not.toContain("/backend");
  expect(commands).not.toContain("/git-status");
  expect(commands).not.toContain("/workspace");
  expect(commands).not.toContain("/repo-report");
});

test("command palette searches commands, examples, descriptions, and categories", () => {
  expect(getCommandMatches("/backend").map((item) => item.command)).toContain("/agent");
  expect(getCommandMatches("/diff").map((item) => item.command)).toContain("/review");
  expect(getCommandMatches("/stash").map((item) => item.command)).toContain("/checkpoint");
  expect(getCommandMatches("/session").map((item) => item.command)).toContain("/sessions");
  expect(getCommandMatches("/engine").map((item) => item.command)).toContain("/engines");
  expect(getCommandMatches("/hub").map((item) => item.command)).toContain("/engine-bay");
  expect(getCommandMatches("/writing").map((item) => item.command)).toContain("/creative");
});
