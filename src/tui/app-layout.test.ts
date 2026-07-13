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
