import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadAllAgents } from "../agent/agents";
import { buildGuidesPromptBlock, loadGuides } from "../context/guides";
import { loadEngineRegistry } from "../engines/registry";
import { loadToolboxInventory } from "../toolbox/hub";
import { loadPluginInventory, normalizePluginManifest } from "./registry";

test("loads workspace plugin manifests and exposes plugin assets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-plugin-"));
  const pluginRoot = join(cwd, ".switchbay", "plugins", "repo-ops");
  await mkdir(join(pluginRoot, "agents"), { recursive: true });
  await mkdir(join(pluginRoot, "skills"), { recursive: true });
  await mkdir(join(pluginRoot, "engines"), { recursive: true });
  await mkdir(join(pluginRoot, "guides"), { recursive: true });

  await writeFile(
    join(pluginRoot, "agents", "repo-steward.md"),
    "# Repo Steward\ndescription: Keeps repo hygiene tight.\n\nYou are operating as a repo steward.",
    "utf-8",
  );
  await writeFile(
    join(pluginRoot, "skills", "repo-check.skill.md"),
    "---\nid: repo-check\nname: Repo Check\ndescription: Check repo state.\nlanguages: [any]\nagents: [any]\ntags: [repo]\ntriggers: [repo]\n---\n\n# Repo Check\n\n## Method\n\n1. Check git status.",
    "utf-8",
  );
  await writeFile(
    join(pluginRoot, "engines", "repo-tools.engine.json"),
    JSON.stringify({
      id: "repo-tools",
      name: "Repo Tools",
      description: "Plugin repo tools.",
      tools: [{ name: "status", description: "Show status", command: "git status --short" }],
    }, null, 2),
    "utf-8",
  );
  await writeFile(
    join(pluginRoot, "guides", "repo-domain.md"),
    "---\nid: repo-domain\ntitle: Repo Domain Guide\nkind: quickstart\ndescription: Stay inside repo hygiene work.\ntriggers: [repo, plugin]\n---\n\n# Repo Domain Guide\n\n- Only operate on repo hygiene tasks.",
    "utf-8",
  );
  await writeFile(
    join(pluginRoot, "plugin.json"),
    JSON.stringify({
      id: "repo-ops",
      name: "Repo Ops",
      description: "Repo hygiene plugin.",
      version: "0.1.0",
      enabled: true,
      agents: ["agents/repo-steward.md"],
      skills: ["skills/repo-check.skill.md"],
      engines: ["engines/repo-tools.engine.json"],
      guides: ["guides/repo-domain.md"],
      knowledge: [],
      mcp: [],
    }, null, 2),
    "utf-8",
  );

  const inventory = await loadPluginInventory(cwd);
  expect(inventory.plugins).toHaveLength(1);
  expect(inventory.plugins[0]?.manifest.id).toBe("repo-ops");

  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const agents = await loadAllAgents();
    expect(agents.some((agent) => agent.id === "repo-steward")).toBe(true);
  } finally {
    process.chdir(previousCwd);
  }

  const skills = await loadToolboxInventory(cwd);
  expect(skills.skills.some((skill) => skill.id === "repo-check" && skill.source === "plugin")).toBe(true);

  const engines = await loadEngineRegistry(cwd);
  expect(engines.engines.some((engine) => engine.id === "repo-tools")).toBe(true);

  const guides = await loadGuides(cwd);
  expect(guides.some((guide) => guide.id === "repo-domain" && guide.source === "plugin")).toBe(true);

  const guideBlock = await buildGuidesPromptBlock(cwd);
  expect(guideBlock).toContain("Repo Domain Guide");
});

test("rejects plugin assets outside known relative folders", () => {
  expect(() => normalizePluginManifest({
    id: "bad-plugin",
    name: "Bad Plugin",
    agents: ["../agent.md"],
  })).toThrow("safe relative path");

  expect(() => normalizePluginManifest({
    id: "bad-plugin",
    name: "Bad Plugin",
    engines: ["engines/not-json.txt"],
  })).toThrow("unsupported path");
});
