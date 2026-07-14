import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUserContextPromptBlock, ensureUserContext, loadUserContext, readUserContextFile } from "./user-context";

test("personal context initializes without overwriting edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "switchbay-user-context-"));
  await ensureUserContext(directory);
  await writeFile(join(directory, "working-style.md"), "# Working Style\n\n- Keep my edits.");
  await ensureUserContext(directory);
  expect(await readFile(join(directory, "working-style.md"), "utf8")).toContain("Keep my edits");
});

test("personal context loads supported files and produces a guarded prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "switchbay-user-context-"));
  await writeFile(join(directory, "style.md"), "Use direct, friendly language.");
  await writeFile(join(directory, ".env"), "SECRET=nope");
  await writeFile(join(directory, "api-token.txt"), "nope");
  await writeFile(join(directory, "ignored.yaml"), "secret: nope");
  const snapshot = await loadUserContext(directory);
  expect(snapshot.files.some((file) => file.name === "style.md")).toBe(true);
  expect(snapshot.files.some((file) => file.name === ".env")).toBe(false);
  expect(snapshot.files.some((file) => file.name === "api-token.txt")).toBe(false);
  expect(snapshot.files.some((file) => file.name === "ignored.yaml")).toBe(false);
  const prompt = await buildUserContextPromptBlock(directory);
  expect(prompt).toContain("Use direct, friendly language.");
  expect(prompt).toContain("workspace-specific instructions override");
  expect((await readUserContextFile("style", directory))?.name).toBe("style.md");
});
