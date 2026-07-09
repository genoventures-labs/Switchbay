import { expect, test } from "bun:test";
import { formatRouteTag } from "./route-display";

test("formatRouteTag renders transparent routing tags", () => {
  expect(formatRouteTag({
    choices: [],
    meta: {
      using: "cloud/anthropic/claude-sonnet-4-5",
      router_intent: "code_work",
      router_mode: "auto",
    },
  })).toBe("Using: cloud/anthropic/claude-sonnet-4-5 · intent=code_work · mode=auto");
});

test("formatRouteTag returns null without routing metadata", () => {
  expect(formatRouteTag({ choices: [] })).toBeNull();
});
