import { expect, test } from "bun:test";
import { AnthropicClient } from "./anthropic-client";

function mockFetch(handler: (url: string | URL | Request, init?: RequestInit | BunFetchRequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

test("Anthropic streaming preserves max_tokens on a truncated tool payload", async () => {
  let requestBody: any;
  const events = [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "write_file" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"large.py","content":"unterminated' } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" } },
    { type: "message_stop" },
  ];
  const client = new AnthropicClient({
    apiBase: "https://api.anthropic.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }),
  });

  const response = await client.createChatCompletion("test", {
    model: "claude-test",
    messages: [{ role: "user", content: "Write a large file" }],
    tools: [{
      type: "function",
      function: {
        name: "write_file",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
    }],
  }, { onToken() {} });

  expect(requestBody.max_tokens).toBe(8192);
  expect(response.choices?.[0]?.finish_reason).toBe("max_tokens");
  expect(response.choices?.[0]?.message?.tool_calls?.[0]?.function.arguments).toContain("unterminated");
});

test("Anthropic receives trained native Bash and text-editor schemas", async () => {
  let requestBody: any;
  const client = new AnthropicClient({
    apiBase: "https://api.anthropic.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 });
    }),
  });

  await client.createChatCompletion("test", {
    model: "claude-test",
    messages: [{ role: "user", content: "Work safely" }],
    tools: [
      { type: "function", function: { name: "native_exec", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "native_editor", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } },
    ],
  });

  expect(requestBody.tools).toContainEqual({ type: "bash_20250124", name: "bash" });
  expect(requestBody.tools).toContainEqual({ type: "text_editor_20250728", name: "str_replace_based_edit_tool" });
  expect(requestBody.tools).toContainEqual(expect.objectContaining({ name: "read_file", input_schema: expect.any(Object) }));
  expect(requestBody.tools).toContainEqual({ type: "web_search_20250305", name: "web_search" });
  expect(requestBody.tools).toContainEqual({ type: "web_fetch_20250910", name: "web_fetch" });
  expect(requestBody.tools).toContainEqual({ type: "code_execution_20250825", name: "code_execution" });
});

test("Anthropic keeps server-managed blocks out of local tool calls and preserves pause continuation", async () => {
  const bodies: any[] = [];
  const pausedContent = [
    {
      type: "text",
      text: "Working",
      citations: [{ type: "web_search_result_location", url: "https://example.com", title: "Example", start_char_index: 0, end_char_index: 7 }],
    },
    { type: "server_tool_use", id: "srvtoolu-1", name: "web_search", input: { query: "current docs" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu-1", content: [{ type: "web_search_result", url: "https://example.com" }] },
    { type: "server_tool_use", id: "srvtoolu-2", name: "code_execution", input: { code: "print('x')" } },
    { type: "code_execution_tool_result", tool_use_id: "srvtoolu-2", content: [{ type: "file", file_id: "file-1", filename: "result.csv", mime_type: "text/csv" }] },
    { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } },
  ];
  const client = new AnthropicClient({
    apiBase: "https://api.anthropic.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        content: pausedContent,
        stop_reason: "pause_turn",
        container: { id: "container-1" },
      }), { status: 200 });
    }),
  });

  const first = await client.createChatCompletion("test", {
    messages: [{ role: "user", content: "Research then inspect" }],
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } }],
  });

  expect(first.choices?.[0]?.message?.tool_calls).toEqual([expect.objectContaining({ id: "tool-1", function: expect.objectContaining({ name: "read_file" }) })]);
  expect(first.choices?.[0]?.message?.provider_content).toEqual(pausedContent);
  expect(first.provider?.events).toHaveLength(4);
  expect(first.provider?.events.every((event) => event.server_managed)).toBe(true);
  expect(first.provider?.citations).toEqual([expect.objectContaining({ url: "https://example.com", start: 0, end: 7 })]);
  expect(first.provider?.artifacts).toEqual([expect.objectContaining({ file_id: "file-1", name: "result.csv", container_id: "container-1" })]);
  expect(first.provider?.continuation).toMatchObject({ provider: "anthropic", kind: "pause_turn", id: "container-1" });

  await client.createChatCompletion("test", {
    messages: [{ role: "assistant", content: "Working", provider_content: first.choices?.[0]?.message?.provider_content }],
  });
  expect(bodies[1].messages[0].content).toEqual(pausedContent);
});

test("Anthropic streaming preserves ordered server events without exposing them as tool calls", async () => {
  const events = [
    { type: "message_start", message: { container: { id: "container-stream" } } },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srv-1", name: "web_fetch" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"url":"https://example.com"}' } },
    { type: "content_block_start", index: 1, content_block: { type: "web_fetch_tool_result", tool_use_id: "srv-1", content: { url: "https://example.com" } } },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Done" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ];
  const client = new AnthropicClient({
    apiBase: "https://api.anthropic.test/v1",
    apiKey: "test-key",
    fetchImpl: mockFetch(async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200 })),
  });

  const response = await client.createChatCompletion("test", { messages: [{ role: "user", content: "Fetch" }] }, { onToken() {} });
  expect(response.choices?.[0]?.message?.content).toBe("Done");
  expect(response.choices?.[0]?.message?.tool_calls).toBeUndefined();
  expect(response.provider?.events.map((event) => [event.type, event.status])).toEqual([
    ["server_tool_use", "started"],
    ["web_fetch_tool_result", "completed"],
  ]);
  expect(response.choices?.[0]?.message?.provider_content).toEqual([
    expect.objectContaining({ type: "server_tool_use", input: { url: "https://example.com" } }),
    expect.objectContaining({ type: "web_fetch_tool_result" }),
    expect.objectContaining({ type: "text", text: "Done" }),
  ]);
});
