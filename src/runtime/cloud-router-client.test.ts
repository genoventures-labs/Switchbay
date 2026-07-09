import { afterEach, expect, test } from "bun:test";
import { CloudRouterClient } from "./cloud-router-client";
import { invalidateCloudProvidersConfig } from "./cloud-providers";
import type { ChatRuntimeClient } from "./client";
import type { ChatCompletionRequest } from "./types";

const savedEnv = {
  OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
  GOOGLE_API_KEY: Bun.env.GOOGLE_API_KEY,
  SWITCHBAY_CLOUD_PROVIDER: Bun.env.SWITCHBAY_CLOUD_PROVIDER,
  SWITCHBAY_CLOUD_ROUTER: Bun.env.SWITCHBAY_CLOUD_ROUTER,
};

afterEach(() => {
  invalidateCloudProvidersConfig();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
  invalidateCloudProvidersConfig();
});

function mockProvider(label: string, calls: string[]): ChatRuntimeClient {
  return {
    async createChatCompletion() {
      calls.push(label);
      return {
        choices: [
          {
            message: { role: "assistant", content: `${label} response` },
            finish_reason: "stop",
          },
        ],
      };
    },
  };
}

function request(text: string): ChatCompletionRequest {
  return {
    messages: [{ role: "user", content: text }],
  };
}

test("cloud router honors an explicit provider", async () => {
  Bun.env.OPENAI_API_KEY = "test-openai";
  Bun.env.ANTHROPIC_API_KEY = "test-anthropic";
  Bun.env.SWITCHBAY_CLOUD_PROVIDER = "anthropic";
  const calls: string[] = [];
  const router = new CloudRouterClient({
    openAi: mockProvider("openai", calls),
    anthropic: mockProvider("anthropic", calls),
  });

  const response = await router.createChatCompletion("dev", request("summarize this"));

  expect(calls).toEqual(["anthropic"]);
  expect(response.meta?.provider).toBe("anthropic");
  expect(response.meta?.router_mode).toBe("explicit");
  expect(response.meta?.using).toContain("cloud/anthropic/");
});

test("cloud router picks OpenAI for structured summaries", async () => {
  Bun.env.OPENAI_API_KEY = "test-openai";
  Bun.env.ANTHROPIC_API_KEY = "test-anthropic";
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  const calls: string[] = [];
  const router = new CloudRouterClient({
    openAi: mockProvider("openai", calls),
    anthropic: mockProvider("anthropic", calls),
  });

  const response = await router.createChatCompletion("dev", request("summarize as strict JSON"));

  expect(calls).toEqual(["openai"]);
  expect(response.meta?.provider).toBe("openai");
  expect(response.meta?.router_intent).toBe("structured_output");
  expect(response.meta?.router_mode).toBe("auto");
  expect(response.meta?.using).toContain("cloud/openai/");
});

test("cloud router picks Anthropic for code work", async () => {
  Bun.env.OPENAI_API_KEY = "test-openai";
  Bun.env.ANTHROPIC_API_KEY = "test-anthropic";
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  const calls: string[] = [];
  const router = new CloudRouterClient({
    openAi: mockProvider("openai", calls),
    anthropic: mockProvider("anthropic", calls),
  });

  const response = await router.createChatCompletion("dev", request("debug this TypeScript repo"));

  expect(calls).toEqual(["anthropic"]);
  expect(response.meta?.provider).toBe("anthropic");
  expect(response.meta?.router_intent).toBe("code_work");
  expect(response.meta?.router_mode).toBe("auto");
  expect(response.meta?.using).toContain("cloud/anthropic/");
});

test("cloud router picks OpenAI for image references", async () => {
  Bun.env.OPENAI_API_KEY = "test-openai";
  Bun.env.ANTHROPIC_API_KEY = "test-anthropic";
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  const calls: string[] = [];
  const router = new CloudRouterClient({
    openAi: mockProvider("openai", calls),
    anthropic: mockProvider("anthropic", calls),
  });

  const response = await router.createChatCompletion("dev", request("inspect this repo screenshot https://example.com/screen.png"));

  expect(calls).toEqual(["openai"]);
  expect(response.meta?.provider).toBe("openai");
  expect(response.meta?.router_intent).toBe("vision");
  expect(response.meta?.router_reason).toContain("Image references");
});

test("cloud router honors Google as an explicit provider", async () => {
  Bun.env.GOOGLE_API_KEY = "test-google";
  Bun.env.SWITCHBAY_CLOUD_PROVIDER = "google";
  const calls: string[] = [];
  const router = new CloudRouterClient({
    google: mockProvider("google", calls),
  });

  const response = await router.createChatCompletion("dev", request("summarize this"));

  expect(calls).toEqual(["google"]);
  expect(response.meta?.provider).toBe("google");
  expect(response.meta?.router_mode).toBe("explicit");
  expect(response.meta?.using).toContain("cloud/google/");
});

test("cloud router uses Google when it is the only configured key", async () => {
  delete Bun.env.OPENAI_API_KEY;
  delete Bun.env.ANTHROPIC_API_KEY;
  Bun.env.GOOGLE_API_KEY = "test-google";
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  const calls: string[] = [];
  const router = new CloudRouterClient({
    google: mockProvider("google", calls),
  });

  const response = await router.createChatCompletion("dev", request("summarize as strict JSON"));

  expect(calls).toEqual(["google"]);
  expect(response.meta?.provider).toBe("google");
  expect(response.meta?.router_mode).toBe("availability");
  expect(response.meta?.using).toContain("cloud/google/");
});
