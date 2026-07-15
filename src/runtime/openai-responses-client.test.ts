import { expect, test } from "bun:test";
import { OpenAiResponsesClient } from "./openai-responses-client";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}

test("translates local functions, prior calls, outputs, and managed tools", async () => {
  let payload: any;
  const client = new OpenAiResponsesClient({
    apiBase: "https://api.openai.test/v1",
    apiKey: "key",
    managedTools: ["web_search", "code_interpreter"],
    fetchImpl: mockFetch((_url, init) => {
      payload = JSON.parse(String(init.body));
      return Response.json({ id: "resp_1", status: "completed", output: [] });
    }),
  });
  await client.createChatCompletion("dev", {
    model: "gpt-test",
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "file body" },
    ],
    tools: [{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object" } } }],
  });
  expect(payload.input).toEqual([
    { role: "user", content: "inspect" },
    { type: "function_call", call_id: "call_1", name: "read_file", arguments: "{\"path\":\"a.ts\"}" },
    { type: "function_call_output", call_id: "call_1", output: "file body" },
  ]);
  expect(payload.tools.map((tool: any) => tool.type)).toEqual(["function", "web_search_preview", "code_interpreter"]);
});

test("keeps managed calls out of local tool_calls and collects evidence", async () => {
  const client = new OpenAiResponsesClient({
    apiKey: "key",
    fetchImpl: mockFetch(() => Response.json({
      id: "resp_2",
      status: "completed",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed", action: { query: "Switchbay" } },
        { type: "code_interpreter_call", id: "ci_1", status: "completed", container_id: "ctr_1", code: "print(1)", outputs: [{ type: "file", file_id: "file_1", filename: "chart.png", mime_type: "image/png" }] },
        { type: "message", content: [{ type: "output_text", text: "Answer", annotations: [{ type: "url_citation", url: "https://example.com", title: "Example", start_index: 0, end_index: 6 }] }] },
      ],
    })),
  });
  const response = await client.createChatCompletion("dev", { messages: [{ role: "user", content: "research" }] });
  expect(response.choices?.[0]?.message?.tool_calls).toBeUndefined();
  expect(response.provider?.events.map((event) => event.name)).toEqual(["web_search", "code_interpreter"]);
  expect(response.provider?.citations[0]?.url).toBe("https://example.com");
  expect(response.provider?.artifacts[0]).toMatchObject({ file_id: "file_1", container_id: "ctr_1" });
  expect(response.provider?.continuation?.id).toBe("resp_2");
});

test("normalizes only function_call items as executable local calls", async () => {
  const client = new OpenAiResponsesClient({ apiKey: "key", fetchImpl: mockFetch(() => Response.json({
    id: "resp_3", status: "completed", output: [
      { type: "function_call", id: "item_1", call_id: "call_3", name: "read_file", arguments: "{\"path\":\"x\"}" },
      { type: "web_search_call", id: "ws_2", status: "completed" },
    ],
  })) });
  const response = await client.createChatCompletion("dev", { messages: [{ role: "user", content: "go" }] });
  expect(response.choices?.[0]?.finish_reason).toBe("tool_calls");
  expect(response.choices?.[0]?.message?.tool_calls).toEqual([{ id: "call_3", type: "function", function: { name: "read_file", arguments: "{\"path\":\"x\"}" } }]);
  expect(response.provider?.events).toHaveLength(1);
});

test("streams text and function arguments", async () => {
  const events = [
    { type: "response.output_text.delta", delta: "Hi" },
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_1", call_id: "call_4", name: "read_file", arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: "{\"path\":" },
    { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: "\"a\"}" },
  ];
  const client = new OpenAiResponsesClient({
    apiKey: "key",
    fetchImpl: mockFetch(() => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n")),
  });
  let streamed = "";
  const response = await client.createChatCompletion("dev", { messages: [{ role: "user", content: "go" }] }, { onToken: (token) => { streamed += token; } });
  expect(streamed).toBe("Hi");
  expect(response.output_text).toBe("Hi");
  expect(response.choices?.[0]?.message?.tool_calls?.[0]?.function.arguments).toBe("{\"path\":\"a\"}");
});

test("preserves incomplete reason and reports API errors", async () => {
  const incomplete = new OpenAiResponsesClient({ apiKey: "key", fetchImpl: mockFetch(() => Response.json({ id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] })) });
  expect((await incomplete.createChatCompletion("dev", { messages: [] })).choices?.[0]?.finish_reason).toBe("max_output_tokens");
  const failed = new OpenAiResponsesClient({ apiKey: "key", fetchImpl: mockFetch(() => new Response("bad request", { status: 400 })) });
  expect(failed.createChatCompletion("dev", { messages: [] })).rejects.toThrow("400 - bad request");
});
