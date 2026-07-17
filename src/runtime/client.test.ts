import { afterEach, expect, test } from "bun:test";
import { createRuntimeClient } from "./client";

const originalFetch = globalThis.fetch;
const originalGoogleKey = Bun.env.GOOGLE_API_KEY;
const originalOpenRouterKey = Bun.env.OPENROUTER_API_KEY;
const originalHfToken = Bun.env.HF_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalGoogleKey === undefined) delete Bun.env.GOOGLE_API_KEY;
  else Bun.env.GOOGLE_API_KEY = originalGoogleKey;
  if (originalOpenRouterKey === undefined) delete Bun.env.OPENROUTER_API_KEY;
  else Bun.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  if (originalHfToken === undefined) delete Bun.env.HF_TOKEN;
  else Bun.env.HF_TOKEN = originalHfToken;
});

test("hosted Hugging Face lane stays explicit and uses HF_TOKEN", async () => {
  Bun.env.HF_TOKEN = "hf_test";
  let request: { url: string; authorization: string | null; model: string } | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), authorization: new Headers(init?.headers).get("authorization"), model: JSON.parse(String(init?.body)).model };
    return Response.json({ choices: [{ message: { role: "assistant", content: "hf response" }, finish_reason: "stop" }] });
  }) as typeof fetch;

  const client = createRuntimeClient("huggingface", { model: "Qwen/example:hf-inference" });
  const response = await client.createChatCompletion("dev", { messages: [{ role: "user", content: "hello" }] });

  expect(request!).toEqual({ url: "https://router.huggingface.co/v1/chat/completions", authorization: "Bearer hf_test", model: "Qwen/example:hf-inference" });
  expect(response.meta?.provider).toBe("huggingface");
  expect(response.meta?.router_mode).toBe("explicit");
});

test("OpenRouter lane is explicit and reports its selected model", async () => {
  Bun.env.OPENROUTER_API_KEY = "test-openrouter";
  let request: { url: string; authorization: string | null; model: string } | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = {
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      model: JSON.parse(String(init?.body)).model,
    };
    return Response.json({ choices: [{ message: { role: "assistant", content: "router response" }, finish_reason: "stop" }] });
  }) as typeof fetch;

  const client = createRuntimeClient("openrouter", { model: "anthropic/claude-test" });
  const response = await client.createChatCompletion("dev", { messages: [{ role: "user", content: "hello" }] });

  expect(request!).toEqual({
    url: "https://openrouter.ai/api/v1/chat/completions",
    authorization: "Bearer test-openrouter",
    model: "anthropic/claude-test",
  });
  expect(response.meta?.provider).toBe("openrouter");
  expect(response.meta?.model).toBe("anthropic/claude-test");
  expect(response.meta?.router_mode).toBe("explicit");
});

test("explicit Gemini provider uses Google and reports complete route metadata", async () => {
  Bun.env.GOOGLE_API_KEY = "test-google";
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return Response.json({
      choices: [{ message: { role: "assistant", content: "gemini response" }, finish_reason: "stop" }],
    });
  }) as typeof fetch;

  const client = createRuntimeClient("cloud", { provider: "google", model: "gemini-test" });
  const response = await client.createChatCompletion("dev", {
    messages: [{ role: "user", content: "hello" }],
  });

  expect(requestedUrl).toContain("generativelanguage.googleapis.com");
  expect(response.meta?.provider).toBe("google");
  expect(response.meta?.model).toBe("gemini-test");
  expect(response.meta?.using).toBe("cloud/google/gemini-test");
});
