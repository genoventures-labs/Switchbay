import { expect, test } from "bun:test";
import { createTranscriptEntry } from "../agent/turn-state";
import { sliceTranscriptForRows } from "./app";

test("transcript slicing keeps user input with an oversized Bay reply", () => {
  const user = createTranscriptEntry({ kind: "user", title: "User", body: "Please reassess Node engines." });
  const assistant = createTranscriptEntry({
    kind: "assistant",
    title: "Assistant",
    body: "A long reply ".repeat(100),
  });

  const result = sliceTranscriptForRows([user, assistant], 2, 8, 70);

  expect(result.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  expect(result.startIndex).toBe(0);
});

test("transcript slicing leaves room for a live response without cutting the feed", () => {
  const user = createTranscriptEntry({ kind: "user", title: "User", body: "Create engine manifests." });
  const progress = createTranscriptEntry({ kind: "tool", title: "Working", body: "reading engine templates...", tone: "info" });
  const result = sliceTranscriptForRows([user, progress], 2, 2, 64);

  expect(result.entries).toEqual([progress]);
});
