import { expect, test } from "bun:test";
import { compactConversationForContext, tryLocalCommand } from "./commands";

const compactingClient = {
  async createChatCompletion() {
    return { choices: [{ message: { role: "assistant", content: "Goal preserved. Current task preserved." } }] };
  },
} as any;

const conversation = [
  { role: "user" as const, content: "First objective" },
  { role: "assistant" as const, content: "First result" },
  { role: "user" as const, content: "Second objective" },
  { role: "assistant" as const, content: "Second result" },
  { role: "user" as const, content: "Latest objective" },
  { role: "assistant" as const, content: "Latest result" },
];

test("context compaction preserves recent exchanges while replacing old provider context", async () => {
  const compacted = await compactConversationForContext({
    client: compactingClient,
    conversation,
    force: true,
    surface: "test",
  });

  expect(compacted?.messages[0]?.content).toContain("[COMPACTED CONTEXT]");
  expect(compacted?.messages.slice(1).map((message) => message.content)).toEqual([
    "Second objective",
    "Second result",
    "Latest objective",
    "Latest result",
  ]);
});

test("manual compact never asks the UI to clear its work feed", async () => {
  const result = await tryLocalCommand("/compact", {
    client: compactingClient,
    conversation,
    profile: "switchbay",
    sessionId: "test-session",
    surface: "test",
    workspace: null,
  });

  expect(result.compactedConversation).toBeDefined();
  expect(result.clearTranscript).toBeUndefined();
});
