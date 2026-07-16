import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importSkill, previewSkillImport } from "./skill-bridge";

const claudeSkill = `---
name: Release Guard
description: Check a release before publishing it.
---

# Release Guard

## Workflow

1. Inspect the release diff.
2. Run the relevant tests.

## Safety

- Never publish when verification fails.
`;

test("skill bridge preserves foreign skill bodies with Switchbay metadata", async () => {
  const preview = await previewSkillImport({ content: claudeSkill, filename: "SKILL.md", provider: "claude", mode: "preserve" });
  expect(preview).toMatchObject({ id: "release-guard", name: "Release Guard", provider: "claude", mode: "preserve" });
  expect(preview.content).toContain("import_mode: preserve");
  expect(preview.content).toContain("## Workflow");
});

test("skill bridge converts common headings and imports without overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchbay-skill-bridge-"));
  const previous = Bun.env.SWITCHBAY_SKILL_AUTHORING_PATH;
  Bun.env.SWITCHBAY_SKILL_AUTHORING_PATH = root;
  try {
    const imported = await importSkill({ content: claudeSkill, filename: "SKILL.md", provider: "auto", mode: "convert" });
    expect(imported.provider).toBe("generic");
    expect(imported.content).toContain("## Method\n\n1. Inspect the release diff.");
    expect(imported.content).toContain("## Guardrails\n\n- Never publish when verification fails.");
    expect(await readFile(imported.destination, "utf8")).toBe(imported.content);
    expect(importSkill({ content: claudeSkill, filename: "SKILL.md", mode: "convert" })).rejects.toThrow("already exists");
  } finally {
    if (previous === undefined) delete Bun.env.SWITCHBAY_SKILL_AUTHORING_PATH; else Bun.env.SWITCHBAY_SKILL_AUTHORING_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
