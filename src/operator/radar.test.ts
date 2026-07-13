import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatFrictionRadar, runFrictionRadar } from "./radar";
import { invalidateCloudProvidersConfig } from "../runtime/cloud-providers";
import { invalidateLocalProvidersConfig } from "../runtime/local-providers";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_CLOUD_PROVIDER: Bun.env.SWITCHBAY_CLOUD_PROVIDER,
  OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
  GOOGLE_API_KEY: Bun.env.GOOGLE_API_KEY,
  GEMINI_API_KEY: Bun.env.GEMINI_API_KEY,
  SWITCHBAY_IGNORE_SERVICE_ENV: Bun.env.SWITCHBAY_IGNORE_SERVICE_ENV,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-radar-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  Bun.env.SWITCHBAY_CLOUD_PROVIDER = "google";
  delete Bun.env.OPENAI_API_KEY;
  delete Bun.env.ANTHROPIC_API_KEY;
  delete Bun.env.GOOGLE_API_KEY;
  delete Bun.env.GEMINI_API_KEY;
  Bun.env.SWITCHBAY_IGNORE_SERVICE_ENV = "1";
  invalidateCloudProvidersConfig();
  invalidateLocalProvidersConfig();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  invalidateCloudProvidersConfig();
  invalidateLocalProvidersConfig();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("radar reports missing explicit cloud provider keys", async () => {
  const signals = await runFrictionRadar({
    cwd: tempDir,
    runtimeLane: "cloud",
    toolMode: "standard",
    workspace: {
      cwd: tempDir,
      repoRoot: null,
      branch: null,
      dirtyFiles: [],
      recentFiles: [],
      diff: null,
    },
  });

  expect(signals.some((signal) => signal.severity === "blocker" && signal.title === "Missing cloud key")).toBe(true);
  expect(formatFrictionRadar(signals)).toContain("Friction Radar");
});
