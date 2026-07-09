import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cloudProvidersConfigPath,
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
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-cloud-providers-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  delete Bun.env.SWITCHBAY_CLOUD_PROVIDER;
  delete Bun.env.SWITCHBAY_OPENAI_MODEL;
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
  expect(cloudProvidersConfigPath()).toBe(path.join(tempDir, "cloud-providers.json"));
});

test("persists the active cloud provider", () => {
  setActiveCloudProvider("anthropic");

  expect(getActiveCloudProvider()).toBe("anthropic");
  expect(JSON.parse(fs.readFileSync(cloudProvidersConfigPath(), "utf-8")).active).toBe("anthropic");
});

test("lets env override configured defaults", () => {
  Bun.env.SWITCHBAY_OPENAI_MODEL = "gpt-test-json";
  invalidateCloudProvidersConfig();

  expect(getCloudProviderConfig("openai").model).toBe("gpt-test-json");
});
