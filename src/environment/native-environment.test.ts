import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureNativeEnvironment,
  executeNativeEditor,
  nativeEnvironmentAvailability,
  resolveNativeEnvironmentPath,
  runInNativeEnvironment,
} from "./native-environment";

test("native environment snapshots ordinary files but excludes secrets and symlinks", async () => {
  if (!nativeEnvironmentAvailability().available) return;
  const source = await mkdtemp(join(tmpdir(), "switchbay-native-source-"));
  const runtime = await mkdtemp(join(tmpdir(), "switchbay-native-runtime-"));
  const outside = join(source, "..", `outside-${Date.now()}.txt`);
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "index.ts"), "console.log('safe')\n");
  await writeFile(join(source, ".env"), "OPENAI_API_KEY=nope\n");
  await writeFile(outside, "outside\n");
  await symlink(outside, join(source, "escape.txt"));

  const handle = await ensureNativeEnvironment("test-session", source, runtime);
  expect(await readFile(join(handle.workspace, "src", "index.ts"), "utf8")).toContain("safe");
  expect(await Bun.file(join(handle.workspace, ".env")).exists()).toBe(false);
  expect(await Bun.file(join(handle.workspace, "escape.txt")).exists()).toBe(false);
  expect(() => resolveNativeEnvironmentPath(handle, "../outside.txt")).toThrow("escapes");
  expect(() => resolveNativeEnvironmentPath(handle, outside)).toThrow("inside");
});

test("native environment runs with scrubbed secrets, no host reads, and isolated writes", async () => {
  if (!nativeEnvironmentAvailability().available) return;
  const source = await mkdtemp(join(tmpdir(), "switchbay-native-source-"));
  const runtime = await mkdtemp(join(tmpdir(), "switchbay-native-runtime-"));
  await writeFile(join(source, "input.txt"), "source\n");
  const handle = await ensureNativeEnvironment("exec-session", source, runtime);
  const previous = Bun.env.OPENAI_API_KEY;
  Bun.env.OPENAI_API_KEY = "must-not-leak";
  try {
    const result = await runInNativeEnvironment(handle, "printf 'made' > generated.txt; printf '%s' \"${OPENAI_API_KEY:-missing}\"");
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("missing");
    expect(await readFile(join(handle.workspace, "generated.txt"), "utf8")).toBe("made");
    expect(await Bun.file(join(source, "generated.txt")).exists()).toBe(false);
    const hostRead = await runInNativeEnvironment(handle, `cat ${JSON.stringify(join(process.env.HOME ?? "", ".ssh", "id_rsa"))}`);
    expect(hostRead.ok).toBe(false);
    const network = await runInNativeEnvironment(handle, `python3 -c 'import socket; socket.create_connection(("1.1.1.1", 53), 1)'`);
    expect(network.ok).toBe(false);
    const timeout = await runInNativeEnvironment(handle, "sleep 2", { timeoutMs: 100 });
    expect(timeout.timedOut).toBe(true);
  } finally {
    if (previous === undefined) delete Bun.env.OPENAI_API_KEY;
    else Bun.env.OPENAI_API_KEY = previous;
  }
});

test("native editor mutates only the disposable snapshot", async () => {
  if (!nativeEnvironmentAvailability().available) return;
  const source = await mkdtemp(join(tmpdir(), "switchbay-native-source-"));
  const runtime = await mkdtemp(join(tmpdir(), "switchbay-native-runtime-"));
  await writeFile(join(source, "app.txt"), "before\n");
  const handle = await ensureNativeEnvironment("editor-session", source, runtime);
  const edited = await executeNativeEditor(handle, { command: "str_replace", path: join(source, "app.txt"), old_str: "before", new_str: "after" });
  expect(edited.ok).toBe(true);
  expect(await readFile(join(handle.workspace, "app.txt"), "utf8")).toBe("after\n");
  expect(await readFile(join(source, "app.txt"), "utf8")).toBe("before\n");
  const outside = join(source, "..", `native-editor-outside-${Date.now()}.txt`);
  await writeFile(outside, "outside\n");
  await symlink(outside, join(handle.workspace, "linked.txt"));
  await expect(executeNativeEditor(handle, { command: "view", path: "linked.txt" })).rejects.toThrow("symlink");
});
