import fs from "node:fs";
import path from "node:path";
import { userConfigDir } from "./paths";

export function readConfiguredSecret(...names: string[]): string | undefined {
  for (const name of names) {
    const direct = Bun.env[name]?.trim();
    if (direct) return direct;
  }

  if (Bun.env.SWITCHBAY_IGNORE_SERVICE_ENV === "1") return undefined;

  const values = readServiceEnvironment();
  for (const name of names) {
    const value = values.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function readServiceEnvironment(): Map<string, string> {
  const result = new Map<string, string>();
  const target = path.join(userConfigDir(), "service", ".env");
  try {
    for (const line of fs.readFileSync(target, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (!match?.[1]) continue;
      result.set(match[1], unquote(match[2] ?? ""));
    }
  } catch {}
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}
