import { afterEach, expect, test } from "bun:test";
import { getCloudModelPresets, listLmStudioModels } from "./models";

const savedEnv = {
  SWITCHBAY_LANE: Bun.env.SWITCHBAY_LANE,
  SWITCHBAY_OPENAI_MODEL: Bun.env.SWITCHBAY_OPENAI_MODEL,
  SWITCHBAY_LMSTUDIO_BASE: Bun.env.SWITCHBAY_LMSTUDIO_BASE,
  SWITCHBAY_LMSTUDIO_API_KEY: Bun.env.SWITCHBAY_LMSTUDIO_API_KEY,
  SWITCHBAY_LMSTUDIO_MODEL: Bun.env.SWITCHBAY_LMSTUDIO_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("cloud presets include the current OpenAI main, mini, and nano models", () => {
  delete Bun.env.SWITCHBAY_OPENAI_MODEL;

  const openAiPresets = getCloudModelPresets()
    .filter((model) => model.provider === "openai")
    .map((model) => model.id);

  expect(openAiPresets.slice(0, 3)).toEqual([
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
  ]);
});

test("lists LM Studio models from the configured host", async () => {
  Bun.env.SWITCHBAY_LANE = "local";
  Bun.env.SWITCHBAY_LMSTUDIO_BASE = "http://192.168.1.50:1234/v1";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "configured-local";
  const urls: string[] = [];

  const result = await listLmStudioModels(async (url) => {
    urls.push(String(url));
    return Response.json({
      data: [
        { id: "qwen-local" },
        { id: "deepseek-local" },
      ],
    });
  });

  expect(urls).toEqual(["http://192.168.1.50:1234/v1/models"]);
  expect(result.notice).toBeUndefined();
  expect(result.models.map((model) => model.id)).toEqual([
    "configured-local",
    "qwen-local",
    "deepseek-local",
  ]);
});

test("falls back to configured LM Studio model when fetch fails", async () => {
  Bun.env.SWITCHBAY_LANE = "local";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "fallback-local";

  const result = await listLmStudioModels(async () => {
    throw new Error("connection refused");
  });

  expect(result.models.map((model) => model.id)).toEqual(["fallback-local"]);
  expect(result.notice).toContain("connection refused");
});

test("explains LM Studio API key setup when model list response is not JSON", async () => {
  Bun.env.SWITCHBAY_LANE = "local";
  Bun.env.SWITCHBAY_LMSTUDIO_BASE = "http://192.168.1.50:1234/v1";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "fallback-local";
  delete Bun.env.SWITCHBAY_LMSTUDIO_API_KEY;

  const result = await listLmStudioModels(async () =>
    new Response("API key required", { status: 200 }),
  );

  expect(result.models.map((model) => model.id)).toEqual(["fallback-local"]);
  expect(result.notice).toContain("SWITCHBAY_LMSTUDIO_API_KEY");
  expect(result.notice).toContain("Generate one in LM Studio");
});

test("sends the LM Studio API key when configured", async () => {
  Bun.env.SWITCHBAY_LANE = "local";
  Bun.env.SWITCHBAY_LMSTUDIO_API_KEY = "lmstudio-test-key";
  const authHeaders: string[] = [];

  await listLmStudioModels(async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    authHeaders.push(headers.Authorization ?? "");
    return Response.json({ data: [] });
  });

  expect(authHeaders).toEqual(["Bearer lmstudio-test-key"]);
});
