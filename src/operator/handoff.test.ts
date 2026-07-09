import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildQuickHandoff } from "./handoff";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_SESSION_DIR: Bun.env.SWITCHBAY_SESSION_DIR,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-handoff-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  Bun.env.SWITCHBAY_SESSION_DIR = path.join(tempDir, "sessions");
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
});

test("quick handoff renders a compact local summary", async () => {
  const handoff = await buildQuickHandoff({
    cwd: tempDir,
    workspace: {
      cwd: tempDir,
      repoRoot: null,
      branch: "main",
      dirtyFiles: [" M src/example.ts"],
      recentFiles: [],
      diff: null,
    },
  });

  expect(handoff).toContain("Quick Handoff");
  expect(handoff).toContain("src/example.ts");
  expect(handoff).toContain("Next:");
});
