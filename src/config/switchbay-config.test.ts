import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearSelectedRuntimeModel, getOperatorConfig, getSelectedRuntimeModel, invalidateConfigCache, loadSwitchbayConfig, setSelectedRuntimeModel } from "./switchbay-config";

const savedEnv = {
  SWITCHBAY_CONFIG_DIR: Bun.env.SWITCHBAY_CONFIG_DIR,
  SWITCHBAY_OPERATOR: Bun.env.SWITCHBAY_OPERATOR,
  SWITCHBAY_STARTUP_OVERVIEW: Bun.env.SWITCHBAY_STARTUP_OVERVIEW,
  SWITCHBAY_DAILY_BOARD: Bun.env.SWITCHBAY_DAILY_BOARD,
};

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-config-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
  delete Bun.env.SWITCHBAY_OPERATOR;
  delete Bun.env.SWITCHBAY_STARTUP_OVERVIEW;
  delete Bun.env.SWITCHBAY_DAILY_BOARD;
  invalidateConfigCache();
});

afterEach(() => {
  invalidateConfigCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

test("operator config defaults on", () => {
  expect(loadSwitchbayConfig().operator).toEqual({
    enabled: true,
    startupOverview: true,
    dailyBoard: true,
  });
});

test("operator env flags override config values", () => {
  Bun.env.SWITCHBAY_OPERATOR = "off";
  Bun.env.SWITCHBAY_STARTUP_OVERVIEW = "0";
  Bun.env.SWITCHBAY_DAILY_BOARD = "no";

  expect(getOperatorConfig()).toEqual({
    enabled: false,
    startupOverview: false,
    dailyBoard: false,
  });
});

test("clearing a selected model restores an unpinned lane", () => {
  setSelectedRuntimeModel("cloud", { id: "gpt-5.5", provider: "openai" });
  expect(getSelectedRuntimeModel("cloud")?.id).toBe("gpt-5.5");

  clearSelectedRuntimeModel("cloud");
  expect(getSelectedRuntimeModel("cloud")).toBeNull();
});
