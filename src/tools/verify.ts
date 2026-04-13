import { runCommand } from "./shell";

export type VerificationSummary = {
  ok: boolean;
  status: "passed" | "failed" | "no_tests";
  command: string;
  summary: string;
  stdout: string;
  stderr: string;
};

export async function runVerification(cwd = process.cwd()): Promise<VerificationSummary> {
  const result = await runCommand(["bun", "test"], cwd);
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const noTestsFound = combinedOutput.includes("No tests found!");

  return {
    ok: result.ok || noTestsFound,
    status: noTestsFound ? "no_tests" : result.ok ? "passed" : "failed",
    command: result.command.join(" "),
    summary: noTestsFound
      ? "No tests found yet."
      : result.ok
        ? "Verification passed."
        : "Verification failed.",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
