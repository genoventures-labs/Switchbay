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
});

afterEach(() => {
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
  expect(description).toContain("structured output · summaries · vision");
  expect(description).toContain("code · tools · workspace implementation");
  expect(description).toContain("research · comparison · long-context synthesis");
  expect(description).toContain("Explicit-only contained lanes: huggingface · openrouter · ollama-cloud");
});

test("auto model pool exposes structured rows for CLI rendering", () => {
  const rows = listAutoModelPool();
  expect(rows.map((row) => row.lane)).toEqual(["openai", "anthropic", "gemini"]);
  expect(rows.every((row) => row.model && row.status && row.specialty)).toBe(true);
});
