import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
  agentSystemPrompt,
  buildAgentDefinition,
  findAgent,
  loadAllAgents,
  saveAgentDefinition,
  slugifyAgentId,
} from "./agents";

test("slugifyAgentId creates stable agent ids", () => {
  expect(slugifyAgentId("API Steward!!")).toBe("api-steward");
  expect(slugifyAgentId("  ")).toBe("custom-agent");
});

test("buildAgentDefinition creates a workspace markdown agent draft", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-agent-draft-"));
  const draft = buildAgentDefinition({
    name: "API Steward",
    specialty: "API design and integration checks",
    approach: "Be direct and cite contracts.",
    rules: "Never expose secrets.",
  }, cwd);

  expect(draft.id).toBe("api-steward");
  expect(draft.savePath).toBe(join(cwd, ".switchbay", "agents", "api-steward.md"));
  expect(draft.content).toContain("id: api-steward");
  expect(draft.content).toContain("description: API design and integration checks");
  expect(draft.content).toContain("Hard rules: Never expose secrets.");
});

test("saveAgentDefinition writes and loadAllAgents loads custom workspace agents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-agent-load-"));

  const draft = await saveAgentDefinition({
    name: "Repo Coach",
    specialty: "repository review and handoffs",
    approach: "Scan first, summarize risk, then suggest the next move.",
    scope: "workspace",
  }, cwd);

  expect(await readFile(draft.savePath, "utf-8")).toContain("# Repo Coach");

  const agents = await loadAllAgents(cwd);
  const agent = findAgent("repo-coach", agents);
  expect(agent?.name).toBe("Repo Coach");
  expect(agent?.source).toBe("workspace");
  expect(agent?.custom).toBe(true);
  expect(agentSystemPrompt(agent!)).toContain("ACTIVE AGENT");
  expect(agentSystemPrompt(agent!)).toContain("repository review and handoffs");
  expect(agentSystemPrompt(agent!)).toContain("Priorities:");
  expect(agentSystemPrompt(agent!)).toContain("Approach:");
});
