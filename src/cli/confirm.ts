/**
 * Prompts the user with a yes/no question on stdin.
 * Returns true if the user answers "y" or "yes" (case-insensitive).
 * Returns false for anything else, including empty input.
 */
export async function confirm(prompt: string): Promise<boolean> {
  process.stdout.write(`${prompt} [y/N] `);
  for await (const line of console) {
    return line.trim().toLowerCase() === "y" || line.trim().toLowerCase() === "yes";
  }
  return false;
}
