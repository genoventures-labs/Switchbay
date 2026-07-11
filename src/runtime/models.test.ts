import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCloudModelPresets, listRuntimeModels, listOllamaModels, pullOllamaModel, normalizeOllamaHuggingFaceModel } from "./models";
import { invalidateLocalProvidersConfig } from "./local-providers";
import { addCloudModel, invalidateCloudModelCatalog } from "./cloud-model-catalog";
import { invalidateCloudProvidersConfig } from "./cloud-providers";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_LANE: Bun.env.SWITCHBAY_LANE,
  SWITCHBAY_OPENAI_MODEL: Bun.env.SWITCHBAY_OPENAI_MODEL,
  SWITCHBAY_GOOGLE_MODEL: Bun.env.SWITCHBAY_GOOGLE_MODEL,
  SWITCHBAY_LOCAL_PROVIDER: Bun.env.SWITCHBAY_LOCAL_PROVIDER,
  SWITCHBAY_OLLAMA_BASE: Bun.env.SWITCHBAY_OLLAMA_BASE,
  SWITCHBAY_OLLAMA_MODEL: Bun.env.SWITCHBAY_OLLAMA_MODEL,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-models-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  invalidateCloudProvidersConfig();
  invalidateCloudModelCatalog();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
  invalidateLocalProvidersConfig();
  invalidateCloudProvidersConfig();
  invalidateCloudModelCatalog();
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
  expect(result.models.map((model) => model.provider)).toContain("google");
});

test("cloud model list includes custom cloud catalog entries", async () => {
  await addCloudModel({
    id: "gpt-custom-json",
    label: "GPT Custom JSON",
    provider: "openai",
    verify: false,
  });

  const result = await listRuntimeModels("cloud");

  expect(result.models).toContainEqual({
    id: "gpt-custom-json",
    label: "GPT Custom JSON",
    lane: "cloud",
    provider: "openai",
    source: "custom",
  });
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
    { url: "http://localhost:11434/api/pull", body: { model: "llama3.2", stream: true } },
  ]);
});

test("normalizes Hugging Face targets to Ollama hf.co format", () => {
  expect(normalizeOllamaHuggingFaceModel("https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF", "Q4_K_M")).toBe("hf.co/lmstudio-community/gpt-oss-20b-GGUF:Q4_K_M");
  expect(normalizeOllamaHuggingFaceModel("https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF/blob/main/gpt-oss-20b-Q4_K_M.gguf")).toBe("hf.co/lmstudio-community/gpt-oss-20b-GGUF:gpt-oss-20b-Q4_K_M.gguf");
  expect(normalizeOllamaHuggingFaceModel("lmstudio-community/gpt-oss-20b-GGUF", "Q4_K_M")).toBe("hf.co/lmstudio-community/gpt-oss-20b-GGUF:Q4_K_M");
  expect(normalizeOllamaHuggingFaceModel("hf.co/lmstudio-community/gpt-oss-20b-GGUF", "Q4_K_M")).toBe("hf.co/lmstudio-community/gpt-oss-20b-GGUF:Q4_K_M");
  expect(normalizeOllamaHuggingFaceModel("lmstudio-community/gpt-oss-20b-GGUF:Q4_K_M")).toBe("hf.co/lmstudio-community/gpt-oss-20b-GGUF:Q4_K_M");
  expect(normalizeOllamaHuggingFaceModel("llama3.2")).toBe("llama3.2");
  expect(normalizeOllamaHuggingFaceModel("llama3.2:3b")).toBe("llama3.2:3b");
});
