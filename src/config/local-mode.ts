import { loadSwitchbayConfig, saveSwitchbayConfig } from "./switchbay-config";

export type LocalMode = "off" | "local" | "offline";

export function getLocalMode(): LocalMode {
  const env = Bun.env.SWITCHBAY_LOCAL_MODE?.trim().toLowerCase();
  if (env === "local") return "local";
  if (env === "offline") return "offline";
  if (env === "off" || env === "false" || env === "0") return "off";
  return (loadSwitchbayConfig().localMode as LocalMode | undefined) ?? "off";
}

export function setLocalMode(mode: LocalMode): void {
  const config = loadSwitchbayConfig();
  saveSwitchbayConfig({ ...config, localMode: mode });
}

export function isLocalModeActive(): boolean {
  return getLocalMode() !== "off";
}

export function isOfflineMode(): boolean {
  return getLocalMode() === "offline";
}

/** Tool names that require network access and are disabled in offline mode. */
export const NETWORK_TOOL_NAMES = new Set([
  "web_tools",
  "web_fetch",
  "web_headers",
  "web_links",
]);
