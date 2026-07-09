import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DAILY_ACTIVE_LIMIT,
  addDailyTask,
  clearDailyBoard,
  completeDailyTask,
  dailyBoardPath,
  describeDailyBoard,
  loadDailyBoard,
} from "./daily-board";

const savedConfigDir = Bun.env.SWITCHBAY_CONFIG_DIR;
let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switchbay-daily-board-"));
  Bun.env.SWITCHBAY_CONFIG_DIR = tempDir;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (savedConfigDir === undefined) {
    delete Bun.env.SWITCHBAY_CONFIG_DIR;
  } else {
    Bun.env.SWITCHBAY_CONFIG_DIR = savedConfigDir;
  }
});

test("starts with an empty daily board in the user config dir", () => {
  const board = loadDailyBoard(new Date("2026-07-09T09:00:00"));

  expect(board.date).toBe("2026-07-09");
  expect(board.items).toEqual([]);
  expect(dailyBoardPath()).toBe(path.join(tempDir, "daily.json"));
});

test("adds and completes daily tasks", () => {
  const first = addDailyTask("test brew", new Date("2026-07-09T09:00:00"));
  const second = addDailyTask("check local lane", new Date("2026-07-09T09:05:00"));

  expect(first.id).toBe(1);
  expect(second.id).toBe(2);
  expect(completeDailyTask(1, new Date("2026-07-09T10:00:00"))?.status).toBe("done");
  expect(describeDailyBoard(new Date("2026-07-09T10:01:00"))).toContain("Done");
});

test("caps active daily tasks at five", () => {
  for (let index = 0; index < DAILY_ACTIVE_LIMIT; index++) {
    addDailyTask(`task ${index + 1}`, new Date("2026-07-09T09:00:00"));
  }

  expect(() => addDailyTask("task 6", new Date("2026-07-09T09:01:00"))).toThrow("Daily board is full");
});

test("rolls over to an empty board on a new day", () => {
  addDailyTask("today only", new Date("2026-07-09T09:00:00"));

  const tomorrow = loadDailyBoard(new Date("2026-07-10T09:00:00"));

  expect(tomorrow.date).toBe("2026-07-10");
  expect(tomorrow.items).toEqual([]);
});

test("clears the current daily board", () => {
  addDailyTask("one", new Date("2026-07-09T09:00:00"));
  addDailyTask("two", new Date("2026-07-09T09:01:00"));

  expect(clearDailyBoard(new Date("2026-07-09T09:02:00"))).toBe(2);
  expect(loadDailyBoard(new Date("2026-07-09T09:03:00")).items).toEqual([]);
});
