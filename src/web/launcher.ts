import { cliPage } from "../cli/presentation";

const WEB_URL = "http://127.0.0.1:4173";
const API_HEALTH = "http://127.0.0.1:7349/health";

export async function openSwitchbayWorkspace(page?: string): Promise<string> {
  await ensureApi();
  if (!(await isReady(WEB_URL))) {
    const child = Bun.spawn(relaunchCommand("web-serve"), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    child.unref();
    await waitFor(`${WEB_URL}/switchbay-health`, "visual workspace");
  }
  const cwd = process.cwd();
  const params = new URLSearchParams();
  if (cwd) params.set("workspace", cwd);
  if (page) params.set("page", page);
  const url = `${WEB_URL}?${params}`;
  openBrowser(url);
  return cliPage({ title: "Switchbay Workspace", state: "Online", body: `Opened ${WEB_URL}\nThe local API and visual workspace are ready.` });
}

async function ensureApi() {
  if (await isReady(API_HEALTH)) return;
  if (process.platform === "darwin") {
    const { runServiceCommand } = await import("../service/macos");
    try { await runServiceCommand("restart"); } catch { await runServiceCommand("install"); }
  } else {
    const child = Bun.spawn(relaunchCommand("serve"), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    child.unref();
  }
  await waitFor(API_HEALTH, "local API");
}

function relaunchCommand(subcommand: string): string[] {
  const entry = process.argv[1] ?? "";
  const scriptLaunch = entry.includes("/") || /\.(?:[cm]?[jt]sx?)$/.test(entry);
  return scriptLaunch ? [process.argv[0]!, entry, subcommand] : [process.argv[0]!, subcommand];
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
}

async function isReady(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(750) })).ok; } catch { return false; }
}

async function waitFor(url: string, name: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isReady(url)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Switchbay could not start the ${name}.`);
}
