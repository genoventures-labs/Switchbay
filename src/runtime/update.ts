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

/**
 * Checks if a newer version of the Toolbox Skills repository is available on GitHub.
 * Returns true if a sync/update is available.
 */
export async function checkForToolboxUpdate(cwd = process.cwd()): Promise<boolean> {
  try {
    const { loadToolboxInventory } = await import("../toolbox/hub");
    const inventory = await loadToolboxInventory(cwd);
    const res = await fetch("https://api.github.com/repos/genoventures-labs/Engine-Toolboxes/commits/main", {
      headers: { "User-Agent": "Switchbay-TUI" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const remoteSha = data.sha;
    if (!remoteSha) return false;

    if (!inventory.exists || !inventory.head) {
      return true; // Needs clone or sync
    }

    const localShortSha = inventory.head.split(" ")[0];
    if (localShortSha && !remoteSha.startsWith(localShortSha)) {
      return true; // Update available
    }
  } catch {
    // Fail silently
  }
  return false;
}
