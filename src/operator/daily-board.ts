import fs from "node:fs";
import path from "node:path";
import { userConfigPath } from "../config/paths";

export type DailyTaskStatus = "active" | "done";

export type DailyTask = {
  id: number;
  text: string;
  status: DailyTaskStatus;
  createdAt: string;
  completedAt?: string;
};

export type DailyBoard = {
  date: string;
  nextId: number;
  items: DailyTask[];
};

const DAILY_FILE = "daily.json";
export const DAILY_ACTIVE_LIMIT = 5;

export function dailyBoardPath(): string {
  return userConfigPath(DAILY_FILE);
}

export function loadDailyBoard(now = new Date()): DailyBoard {
  const today = dateKey(now);
  const target = dailyBoardPath();
  try {
    if (fs.existsSync(target)) {
      const parsed = normalizeDailyBoard(JSON.parse(fs.readFileSync(target, "utf-8")));
      if (parsed.date === today) return parsed;
    }
  } catch {
    // Fall through to a fresh board.
  }
  return { date: today, nextId: 1, items: [] };
}

export function saveDailyBoard(board: DailyBoard): DailyBoard {
  const normalized = normalizeDailyBoard(board);
  const target = dailyBoardPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  return normalized;
}

export function addDailyTask(text: string, now = new Date()): DailyTask {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text cannot be empty.");
  const board = loadDailyBoard(now);
  const active = board.items.filter((item) => item.status === "active");
  if (active.length >= DAILY_ACTIVE_LIMIT) {
    throw new Error(`Daily board is full (${DAILY_ACTIVE_LIMIT} active items). Mark one done or clear the board first.`);
  }

  const task: DailyTask = {
    id: board.nextId,
    text: trimmed,
    status: "active",
    createdAt: now.toISOString(),
  };
  saveDailyBoard({
    ...board,
    nextId: board.nextId + 1,
    items: [...board.items, task],
  });
  return task;
}

export function completeDailyTask(id: number, now = new Date()): DailyTask | null {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Task id must be a positive number.");
  const board = loadDailyBoard(now);
  let completed: DailyTask | null = null;
  const items = board.items.map((item) => {
    if (item.id !== id) return item;
    completed = {
      ...item,
      status: "done",
      completedAt: item.completedAt ?? now.toISOString(),
    };
    return completed;
  });
  if (!completed) return null;
  saveDailyBoard({ ...board, items });
  return completed;
}

export function clearDailyBoard(now = new Date()): number {
  const board = loadDailyBoard(now);
  const count = board.items.length;
  saveDailyBoard({ date: dateKey(now), nextId: 1, items: [] });
  return count;
}

export function describeDailyBoard(now = new Date()): string {
  return formatDailyBoard(loadDailyBoard(now));
}

export function formatDailyBoard(board: DailyBoard): string {
  const active = board.items.filter((item) => item.status === "active");
  const done = board.items.filter((item) => item.status === "done");
  const lines = [
    "Daily Board",
    `Date: ${board.date}`,
    `Active: ${active.length}/${DAILY_ACTIVE_LIMIT}`,
  ];

  if (!board.items.length) {
    lines.push("", "No tasks yet. Add one with `switchbay task add \"test brew\"`.");
    return lines.join("\n");
  }

  if (active.length) {
    lines.push("", "Open");
    lines.push(...active.map((item) => `${item.id}. ${item.text}`));
  }

  if (done.length) {
    lines.push("", "Done");
    lines.push(...done.map((item) => `${item.id}. ${item.text}`));
  }

  return lines.join("\n");
}

function normalizeDailyBoard(value: unknown): DailyBoard {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { date: dateKey(new Date()), nextId: 1, items: [] };
  }
  const raw = value as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items.flatMap(normalizeTask)
    : [];
  const maxId = items.reduce((max, item) => Math.max(max, item.id), 0);
  const nextId = positiveInt(raw.nextId, maxId + 1);
  return {
    date: typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : dateKey(new Date()),
    nextId: Math.max(nextId, maxId + 1, 1),
    items,
  };
}

function normalizeTask(value: unknown): DailyTask[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const id = positiveInt(raw.id, 0);
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!id || !text) return [];
  const status: DailyTaskStatus = raw.status === "done" ? "done" : "active";
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim()
    ? raw.createdAt
    : new Date().toISOString();
  const completedAt = typeof raw.completedAt === "string" && raw.completedAt.trim()
    ? raw.completedAt
    : undefined;
  return [{
    id,
    text,
    status,
    createdAt,
    ...(completedAt ? { completedAt } : {}),
  }];
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
