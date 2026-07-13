import { expect, test } from "bun:test";
import { suggestRuntimeLane } from "./lane-router";

test("suggests local for contained and privacy-sensitive work", () => {
  expect(suggestRuntimeLane("Rewrite this paragraph more clearly")?.lane).toBe("local");
  expect(suggestRuntimeLane("Keep this confidential and summarize it")?.lane).toBe("local");
  expect(suggestRuntimeLane("Inspect this markdown file")?.lane).toBe("local");
});

test("keeps cloud for complex, current, visual, and external work", () => {
  expect(suggestRuntimeLane("Refactor the architecture across the entire repo")).toBeNull();
  expect(suggestRuntimeLane("Research the latest MCP specification")).toBeNull();
  expect(suggestRuntimeLane("Inspect this screenshot")).toBeNull();
  expect(suggestRuntimeLane("/model local")).toBeNull();
});
