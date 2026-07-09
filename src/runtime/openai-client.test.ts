import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { OpenAiClient } from "./openai-client";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string | URL | Request, init?: RequestInit | BunFetchRequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

test("OpenAI client sends image URLs as multimodal content parts", async () => {
  let payload: any;
  const client = new OpenAiClient({
    apiBase: "https://api.openai.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "saw it" }, finish_reason: "stop" }],
      });
    }),
  });

  await client.createChatCompletion("dev", {
    model: "gpt-test",
    messages: [{ role: "user", content: "Read this screenshot https://example.com/ui.png" }],
  });

  expect(payload.messages[0].content).toEqual([
    { type: "text", text: "Read this screenshot https://example.com/ui.png" },
    { type: "image_url", image_url: { url: "https://example.com/ui.png" } },
  ]);
});

test("OpenAI client converts local image paths to base64 data URLs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-vision-"));
  const imagePath = join(cwd, "screen.png");
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  let payload: any;
  const client = new OpenAiClient({
    apiBase: "https://api.openai.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "saw file" }, finish_reason: "stop" }],
      });
    }),
  });

  await client.createChatCompletion("dev", {
    model: "gpt-test",
    messages: [{ role: "user", content: `Read ${imagePath}` }],
  });

  expect(payload.messages[0].content[1]).toEqual({
    type: "image_url",
    image_url: { url: "data:image/png;base64,iVBORw==" },
  });
});
