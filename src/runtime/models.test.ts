import { afterEach, expect, test } from "bun:test";
import { getCloudModelPresets, listRuntimeModels, listLmStudioModels, listOllamaModels, pullLmStudioModel, pullOllamaModel } from "./models";
import { invalidateLocalProvidersConfig } from "./local-providers";

const savedEnv = {
  SWITCHBAY_LANE: Bun.env.SWITCHBAY_LANE,
  SWITCHBAY_OPENAI_MODEL: Bun.env.SWITCHBAY_OPENAI_MODEL,
  SWITCHBAY_LMSTUDIO_BASE: Bun.env.SWITCHBAY_LMSTUDIO_BASE,
  SWITCHBAY_LMSTUDIO_API_KEY: Bun.env.SWITCHBAY_LMSTUDIO_API_KEY,
  SWITCHBAY_LMSTUDIO_MODEL: Bun.env.SWITCHBAY_LMSTUDIO_MODEL,
  SWITCHBAY_LOCAL_PROVIDER: Bun.env.SWITCHBAY_LOCAL_PROVIDER,
  SWITCHBAY_OLLAMA_BASE: Bun.env.SWITCHBAY_OLLAMA_BASE,
  SWITCHBAY_OLLAMA_MODEL: Bun.env.SWITCHBAY_OLLAMA_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
  invalidateLocalProvidersConfig();
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

test("cloud MCP model list uses cloud presets on the cloud-mcp lane", async () => {
  const result = await listRuntimeModels("cloud-mcp");

  expect(result.models.length).toBeGreaterThan(0);
  expect(result.models.every((model) => model.lane === "cloud-mcp")).toBe(true);
  expect(result.models.map((model) => model.provider)).toContain("openai");
  expect(result.models.map((model) => model.provider)).toContain("anthropic");
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

  expect(urls).toEqual([
    "http://192.168.1.50:1234/api/v1/models",
    "http://192.168.1.50:1234/v1/models",
  ]);
  expect(result.notice).toBeUndefined();
  expect(result.models.map((model) => model.id)).toEqual([
    "qwen-local",
    "deepseek-local",
  ]);
});

test("does not invent an LM Studio model when fetch fails", async () => {
  Bun.env.SWITCHBAY_LANE = "local";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "fallback-local";

  const result = await listLmStudioModels(async () => {
    throw new Error("connection refused");
  });

  expect(result.models.map((model) => model.id)).toEqual([]);
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

  expect(result.models.map((model) => model.id)).toEqual([]);
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

  expect(authHeaders).toEqual(["Bearer lmstudio-test-key", "Bearer lmstudio-test-key"]);
});

test("lists LM Studio models for the native MCP lane", async () => {
  Bun.env.SWITCHBAY_LANE = "local-mcp";
  Bun.env.SWITCHBAY_LMSTUDIO_MODEL = "mcp-default";

  const result = await listLmStudioModels(async () =>
    Response.json({ data: [{ id: "tool-ready-local" }] }),
  "local-mcp");

  expect(result.models.map((model) => model.lane)).toEqual(["local-mcp"]);
  expect(result.models.map((model) => model.provider)).toEqual(["lmstudio-mcp"]);
});

test("prefers native LM Studio model keys when available", async () => {
  Bun.env.SWITCHBAY_LANE = "local-mcp";
  Bun.env.SWITCHBAY_LMSTUDIO_BASE = "http://192.168.1.50:1234/v1";
  const urls: string[] = [];

  const result = await listLmStudioModels(async (url) => {
    urls.push(String(url));
    return Response.json({
      models: [
        { key: "qwen/qwen3-4b-2507", display_name: "Qwen3 4B MLX" },
      ],
    });
  }, "local-mcp");

  expect(urls).toEqual(["http://192.168.1.50:1234/api/v1/models"]);
  expect(result.models.map((model) => model.id)).toEqual(["qwen/qwen3-4b-2507"]);
  expect(result.models[0]?.label).toBe("Qwen3 4B MLX");
});

test("pulls an LM Studio model by downloading, polling, and loading", async () => {
  Bun.env.SWITCHBAY_LMSTUDIO_BASE = "http://192.168.1.50:1234/v1";
  Bun.env.SWITCHBAY_LMSTUDIO_API_KEY = "lm-key";
  const requests: Array<{ url: string; method: string; body?: unknown; authorization?: string }> = [];

  const result = await pullLmStudioModel({
    model: "ibm/granite-4-micro",
    quantization: "Q4_K_M",
    pollDelayMs: 0,
    fetchImpl: async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        authorization: (init?.headers as Record<string, string>)?.Authorization,
      });

      if (String(url).endsWith("/models/download")) {
        return Response.json({ job_id: "job_123", status: "downloading" });
      }
      if (String(url).endsWith("/models/download/status/job_123")) {
        return Response.json({ job_id: "job_123", status: "completed" });
      }
      if (String(url).endsWith("/models/load")) {
        return Response.json({
          status: "loaded",
          instance_id: "ibm/granite-4-micro",
          load_time_seconds: 3.2,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  expect(result).toEqual({
    model: "ibm/granite-4-micro",
    downloadStatus: "completed",
    jobId: "job_123",
    loadStatus: "loaded",
    instanceId: "ibm/granite-4-micro",
    loadTimeSeconds: 3.2,
  });
  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
    "POST http://192.168.1.50:1234/api/v1/models/download",
    "GET http://192.168.1.50:1234/api/v1/models/download/status/job_123",
    "POST http://192.168.1.50:1234/api/v1/models/load",
  ]);
  expect(requests[0]?.body).toEqual({ model: "ibm/granite-4-micro", quantization: "Q4_K_M" });
  expect(requests[2]?.body).toEqual({ model: "ibm/granite-4-micro", echo_load_config: true });
  expect(requests.every((request) => request.authorization === "Bearer lm-key")).toBe(true);
});

test("lists Ollama models from the active local provider", async () => {
  Bun.env.SWITCHBAY_LOCAL_PROVIDER = "ollama";
  Bun.env.SWITCHBAY_OLLAMA_BASE = "http://localhost:11434/api";
  invalidateLocalProvidersConfig();

  const listed = await listOllamaModels(async (url) => {
    expect(String(url)).toBe("http://localhost:11434/api/tags");
    return Response.json({
      models: [
        { name: "llama3.2:latest", details: { parameter_size: "3.2B", quantization_level: "Q4_K_M" } },
      ],
    });
  });

  expect(listed.models).toEqual([
    {
      id: "llama3.2:latest",
      label: "llama3.2:latest (3.2B Q4_K_M)",
      lane: "local",
      provider: "ollama",
      source: "ollama",
    },
  ]);
});

test("pulls an Ollama model through the configured API", async () => {
  Bun.env.SWITCHBAY_OLLAMA_BASE = "http://localhost:11434";
  invalidateLocalProvidersConfig();
  const requests: Array<{ url: string; body: unknown }> = [];

  const result = await pullOllamaModel({
    model: "llama3.2",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ status: "success" });
    },
  });

  expect(result).toEqual({ model: "llama3.2", status: "success" });
  expect(requests).toEqual([
    { url: "http://localhost:11434/api/pull", body: { model: "llama3.2", stream: false } },
  ]);
});
