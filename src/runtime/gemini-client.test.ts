import { expect, test } from "bun:test";
import { GeminiClient } from "./gemini-client";

test("Gemini native adapter translates tools and separates managed observations", async () => {
  let requestedUrl = "";
  let requestedBody: any;
  const client = new GeminiClient({
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "test-key",
    fetchImpl: (async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({
        candidates: [{
          finishReason: "STOP",
          content: { role: "model", parts: [
            { thought: true, text: "private", thoughtSignature: "signed-thought" },
            { executableCode: { language: "PYTHON", code: "print(2)" } },
            { codeExecutionResult: { outcome: "OUTCOME_OK", output: "2" } },
            { text: "Answer" },
            { functionCall: { id: "call-1", name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "signed-call" },
          ] },
          groundingMetadata: {
            webSearchQueries: ["switchbay"],
            searchEntryPoint: { renderedContent: "search chip" },
            groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
            groundingSupports: [{ segment: { startIndex: 0, endIndex: 6 }, groundingChunkIndices: [0] }],
          },
          urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com" }] },
        }],
      });
    }) as typeof fetch,
  });

  const response = await client.createChatCompletion("test", {
    model: "gemini-test",
    messages: [
      { role: "system", content: "Be useful" },
      { role: "user", content: "Research this" },
    ],
    tools: [{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } } }],
    tool_choice: "auto",
  });

  expect(requestedUrl).toContain("/v1beta/models/gemini-test:generateContent?key=test-key");
  expect(requestedBody.systemInstruction.parts[0].text).toBe("Be useful");
  expect(requestedBody.tools).toEqual(expect.arrayContaining([
    { googleSearch: {} }, { urlContext: {} }, { codeExecution: {} },
  ]));
  expect(requestedBody.tools[0].functionDeclarations[0].name).toBe("read_file");
  expect(response.choices?.[0]?.message?.content).toBe("Answer");
  expect(response.choices?.[0]?.message?.tool_calls?.[0]?.function).toEqual({ name: "read_file", arguments: '{"path":"a.ts"}' });
  expect(response.provider?.events.map((event) => event.type)).toEqual(["google_search", "url_context", "code_execution", "code_execution"]);
  expect(response.provider?.citations[0]).toEqual({ provider: "google", url: "https://example.com/source", title: "Source", start: 0, end: 6 });
  expect((response.choices?.[0]?.message?.provider_content as any[])[0].thoughtSignature).toBe("signed-thought");
});

test("Gemini native adapter replays provider content and streams SSE tokens", async () => {
  let requestedBody: any;
  const chunks = [
    { candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ text: "lo" }, { functionCall: { id: "c2", name: "lookup", args: { q: 1 } }, thoughtSignature: "sig" }] }, finishReason: "STOP" }] },
  ];
  const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  const client = new GeminiClient({
    apiBase: "https://example.test/v1beta",
    apiKey: "key",
    fetchImpl: (async (_input, init) => {
      requestedBody = JSON.parse(String(init?.body));
      return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch,
  });
  const tokens: string[] = [];
  const preserved = [{ thought: true, text: "reason", thoughtSignature: "old-sig" }, { text: "prior" }];
  const response = await client.createChatCompletion("test", {
    messages: [
      { role: "assistant", content: "prior", provider_content: preserved },
      { role: "user", content: "continue" },
    ],
  }, { onToken: (token) => tokens.push(token) });

  expect(requestedBody.contents[0]).toEqual({ role: "model", parts: preserved });
  expect(tokens).toEqual(["Hel", "lo"]);
  expect(response.choices?.[0]?.message?.content).toBe("Hello");
  expect(response.choices?.[0]?.message?.tool_calls?.[0]?.id).toBe("c2");
  expect((response.choices?.[0]?.message?.provider_content as any[])[2].thoughtSignature).toBe("sig");
});
