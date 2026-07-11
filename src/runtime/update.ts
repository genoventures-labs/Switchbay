import packageJson from "../../package.json";

/**
 * Checks if a newer version of Switchbay is available on GitHub.
 * Returns the version string of the update if available, or null.
 */
export async function checkForUpdate(): Promise<string | null> {
  try {
    const current = packageJson.version;
    const res = await fetch("https://raw.githubusercontent.com/genoventures-labs/Switchbay/main/package.json", {
      headers: { "User-Agent": "Switchbay-TUI" },
      signal: AbortSignal.timeout(2000), // 2 seconds timeout to prevent hanging on startup
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data.version;
    if (latest && latest !== current) {
      return latest;
    }
  } catch {
    // Fail silently if offline or request fails
  }
  return null;
}
