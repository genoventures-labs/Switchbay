import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cloudProvidersConfigPath,
  describeAutoModelPool,
  listAutoModelPool,
  getActiveCloudProvider,
  getCloudProviderConfig,
  invalidateCloudProvidersConfig,
  loadCloudProvidersConfig,
  setActiveCloudProvider,
} from "./cloud-providers";
import { invalidateCloudModelCatalog } from "./cloud-model-catalog";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_CLOUD_PROVIDER: Bun.env.SWITCHBAY_CLOUD_PROVIDER,
  SWITCHBAY_OPENAI_MODEL: Bun.env.SWITCHBAY_OPENAI_MODEL,
  SWITCHBAY_GOOGLE_MODEL: Bun.env.SWITCHBAY_GOOGLE_MODEL,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-cloud-providers-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  delete Bun.env.SWITCHBAY_OPENAI_MODEL;
  delete Bun.env.SWITCHBAY_GOOGLE_MODEL;
  invalidateCloudProvidersConfig();
  invalidateCloudModelCatalog();
});

afterEach(() => {
  invalidateCloudProvidersConfig();
  invalidateCloudModelCatalog();
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("loads default cloud provider config from the user config dir", () => {
  const config = loadCloudProvidersConfig();

  expect(config.active).toBe("auto");
  expect(config.providers.openai.apiKeyEnv).toBe("OPENAI_API_KEY");
  expect(config.providers.google.apiKeyEnv).toBe("GOOGLE_API_KEY");
  expect(config.providers.google.apiBase).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  expect(cloudProvidersConfigPath()).toBe(path.join(tempDir, "cloud-providers.json"));
});

test("persists the active cloud provider", () => {
  setActiveCloudProvider("anthropic");

  expect(getActiveCloudProvider()).toBe("anthropic");
  expect(JSON.parse(fs.readFileSync(cloudProvidersConfigPath(), "utf-8")).active).toBe("anthropic");
});

test("lets env override configured defaults", () => {
  Bun.env.SWITCHBAY_OPENAI_MODEL = "gpt-test-json";
  Bun.env.SWITCHBAY_GOOGLE_MODEL = "gemini-test-json";
  invalidateCloudProvidersConfig();

  expect(getCloudProviderConfig("openai").model).toBe("gpt-test-json");
  expect(getCloudProviderConfig("google").model).toBe("gemini-test-json");
});

test("auto model pool explains trusted routing and contained lanes", () => {
  const description = describeAutoModelPool();
  expect(description).toContain("Trusted cloud auto pool");
  expect(description).toContain("Explicit-only contained lanes: huggingface · openrouter · ollama-cloud");
});

test("auto model pool is empty when no verified models are in the catalog", () => {
  const rows = listAutoModelPool();
  expect(rows).toEqual([]);
});

test("auto model pool reflects verified catalog models", () => {
  const { invalidateCloudModelCatalog, saveCloudModelCatalog } = require("./cloud-model-catalog");
  saveCloudModelCatalog({
    models: [
      { id: "gpt-test", provider: "openai", addedAt: "2026-01-01T00:00:00.000Z", verifiedAt: "2026-01-01T00:00:00.000Z" },
      { id: "claude-test", provider: "anthropic", addedAt: "2026-01-01T00:00:00.000Z" },
    ],
  });
  invalidateCloudModelCatalog();
  const rows = listAutoModelPool();
  expect(rows.length).toBe(1);
  expect(rows[0]!.model).toBe("gpt-test");
  expect(rows[0]!.provider).toBe("openai");
  expect(rows[0]!.verifiedAt).toBeTruthy();
  invalidateCloudModelCatalog();
});
