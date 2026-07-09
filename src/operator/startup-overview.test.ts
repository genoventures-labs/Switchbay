import { expect, test } from "bun:test";
import type { WorkspaceSnapshot } from "../session/workspace";
import { buildStartupOverview } from "./startup-overview";

const workspace: WorkspaceSnapshot = {
  cwd: "/Users/cass/Projects/Switchbay",
  repoRoot: "/Users/cass/Projects/Switchbay",
  branch: "main",
  dirtyFiles: [" M src/tui/app.tsx"],
  recentFiles: [],
  diff: null,
};

test("builds a compact startup overview from local state", () => {
  const overview = buildStartupOverview({
    workspace,
    runtimeBadge: "Cloud · gpt-5.5",
    dailyBoard: {
      date: "2026-07-09",
      nextId: 2,
      items: [
        {
          id: 1,
          text: "test brew install",
          status: "active",
          createdAt: "2026-07-09T09:00:00.000Z",
        },
      ],
    },
    sessions: [{ id: "abc", title: "Cloud provider JSON wiring", updatedAt: 1 }],
  });

  expect(overview).toContain("Morning. Here's the board.");
  expect(overview).toContain("Today: 1/5 open · next: test brew install");
  expect(overview).toContain("Workspace: Switchbay on main · 1 dirty");
  expect(overview).toContain("Lane: Cloud · gpt-5.5");
  expect(overview).toContain("Last: Cloud provider JSON wiring");
});

test("nudges task creation when the board is empty", () => {
  const overview = buildStartupOverview({
    workspace: null,
    runtimeBadge: "Cloud",
    dailyBoard: {
      date: "2026-07-09",
      nextId: 1,
      items: [],
    },
    sessions: [],
  });

  expect(overview).toContain("Today: 0/5 open");
  expect(overview).toContain("unknown workspace");
  expect(overview).toContain("Add a task with `/task add <text>`");
});
