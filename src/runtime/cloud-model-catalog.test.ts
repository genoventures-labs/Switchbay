import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addCloudModel,
  cloudModelCatalogPath,
  inferCloudModelProvider,
  invalidateCloudModelCatalog,
  loadCloudModelCatalog,
} from "./cloud-model-catalog";
import { invalidateCloudProvidersConfig } from "./cloud-providers";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-cloud-models-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  delete Bun.env.OPENAI_API_KEY;
  invalidateCloudModelCatalog();
  invalidateCloudProvidersConfig();
});

afterEach(() => {
  invalidateCloudModelCatalog();
  invalidateCloudProvidersConfig();
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("adds a custom cloud model to the user catalog", async () => {
  const result = await addCloudModel({
    id: "gpt-next-test",
    label: "GPT Next Test",
    provider: "openai",
    verify: false,
  });

  expect(result.model).toMatchObject({
    id: "gpt-next-test",
    label: "GPT Next Test",
    provider: "openai",
  });
  expect(cloudModelCatalogPath()).toBe(path.join(tempDir, "cloud-models.json"));
  expect(loadCloudModelCatalog().models.map((model) => model.id)).toEqual(["gpt-next-test"]);
});

test("validates OpenAI models when a key is available", async () => {
  Bun.env.OPENAI_API_KEY = "test-key";
  invalidateCloudProvidersConfig();
  const urls: string[] = [];
  const result = await addCloudModel({
    id: "gpt-live-test",
    provider: "openai",
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return Response.json({ id: "gpt-live-test" });
    },
  });

  expect(result.verified).toBe(true);
  expect(result.model.verifiedAt).toBeDefined();
  expect(urls).toEqual(["https://api.openai.com/v1/models/gpt-live-test"]);
});

test("infers cloud model provider from ids", () => {
  expect(inferCloudModelProvider("claude-sonnet-4-5")).toBe("anthropic");
  expect(inferCloudModelProvider("gemini-3.5-flash")).toBe("google");
  expect(inferCloudModelProvider("gpt-5.5")).toBe("openai");
});
