export type ShellResult = {
  command: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  ok: boolean;
};

export async function runCommand(
  command: string[],
  cwd = process.cwd(),
): Promise<ShellResult> {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    command,
    cwd,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    ok: exitCode === 0,
  };
}
