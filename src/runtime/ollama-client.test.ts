import { afterEach, expect, test } from "bun:test";
import { OllamaClient } from "./ollama-client";
import { invalidateLocalProvidersConfig } from "./local-providers";

const savedEnv = {
  SWITCHBAY_OLLAMA_BASE: Bun.env.SWITCHBAY_OLLAMA_BASE,
  SWITCHBAY_OLLAMA_MODEL: Bun.env.SWITCHBAY_OLLAMA_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  invalidateLocalProvidersConfig();
});

test("Ollama client normalizes chat responses", async () => {
  Bun.env.SWITCHBAY_OLLAMA_BASE = "http://localhost:11434/api";
  Bun.env.SWITCHBAY_OLLAMA_MODEL = "llama3.2";
  invalidateLocalProvidersConfig();
  const requests: Array<{ url: string; body: any }> = [];
  const client = new OllamaClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({
        model: "llama3.2",
        message: { role: "assistant", content: "local answer" },
        done: true,
        done_reason: "stop",
      });
    },
  });

  const response = await client.createChatCompletion("dev", {
    messages: [{ role: "user", content: "hello" }],
  });

  expect(requests[0]?.url).toBe("http://localhost:11434/api/chat");
  expect(requests[0]?.body.model).toBe("llama3.2");
  expect(requests[0]?.body.stream).toBe(false);
  expect(response.choices?.[0]?.message?.content).toBe("local answer");
  expect(response.meta?.provider).toBe("ollama");
});
