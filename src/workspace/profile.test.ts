import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceProfile, refreshWorkspaceProfile } from "./profile";

test("workspace profile derives stable project facts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchbay-profile-"));
  await Bun.write(join(cwd, "package.json"), JSON.stringify({ name: "demo", description: "Demo app", scripts: { test: "bun test" }, dependencies: { react: "x" }, devDependencies: { typescript: "x" } }));
  await Bun.write(join(cwd, "bun.lock"), "");
  const profile = await refreshWorkspaceProfile(cwd);
  expect(profile).toMatchObject({ name: "demo", purpose: "Demo app", packageManager: "bun" });
  expect(profile.stack).toContain("React");
  expect((await loadWorkspaceProfile(cwd))?.commands.test).toBe("bun test");
});
