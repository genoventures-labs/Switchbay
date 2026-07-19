import fs from "node:fs";
import path from "node:path";
import { userConfigPath } from "../config/paths";

const FILE = "model-grades.json";

export type ModelGradeEntry = {
  modelId: string;
  provider: string;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  score: number;
  passedTests: number;
  totalTests: number;
  benchedAt: number;
};

type GradeStore = { entries: ModelGradeEntry[] };

function storePath(): string {
  return userConfigPath(FILE);
}

function load(): GradeStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    if (Array.isArray(raw?.entries)) return raw as GradeStore;
  } catch { /* first run */ }
  return { entries: [] };
}

function save(store: GradeStore): void {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export function saveModelGrade(entry: ModelGradeEntry): void {
  const store = load();
  const key = `${entry.provider}:${entry.modelId}`;
  store.entries = store.entries.filter((e) => `${e.provider}:${e.modelId}` !== key);
  store.entries.push(entry);
  save(store);
}

export function getModelGrade(provider: string, modelId: string): ModelGradeEntry | null {
  return load().entries.find((e) => e.provider === provider && e.modelId === modelId) ?? null;
}

export function getAllGrades(): ModelGradeEntry[] {
  return load().entries;
}

export function isTrusted(entry: ModelGradeEntry): boolean {
  return entry.grade === "A+" || entry.grade === "A" || entry.grade === "B";
}
