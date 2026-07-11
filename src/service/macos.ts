import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runCommand } from "../tools/shell";

const LABEL = "com.genoventures.switchbay-api";
const home = homedir();
const root = join(home, ".switchbay");
const app = join(root, "service", "index.js");
const envFile = join(root, "service", ".env");
const token = join(root, "api-token");
const plist = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
const target = `gui/${process.getuid?.() ?? 501}`;

export async function runServiceCommand(action: "install" | "status" | "restart" | "uninstall"): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Switchbay service commands currently support macOS only.");
  if (action === "install") return install();
  if (action === "restart") { await ensureLoaded(); await launchctl(["kickstart", "-k", `${target}/${LABEL}`]); return "Switchbay API restarted at http://127.0.0.1:7349."; }
  if (action === "uninstall") { await launchctl(["bootout", `${target}/${LABEL}`], true); await rm(plist, { force: true }); await rm(join(root, "service"), { recursive: true, force: true }); return "Switchbay API service removed. Token, sessions, memory, and logs were preserved."; }
  const result = await runCommand(["launchctl", "print", `${target}/${LABEL}`]);
  return result.ok ? `Switchbay API service is installed and loaded.\nURL: http://127.0.0.1:7349\nToken: ${token}` : "Switchbay API service is not loaded. Run: switchbay service install";
}

async function install(): Promise<string> {
  await mkdir(join(root, "service"), { recursive: true });
  await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
  const bun = Bun.which("bun") ?? join(home, ".bun", "bin", "bun");
  const sourceRoot = [join(import.meta.dir, "..", ".."), process.cwd()].find(path => existsSync(join(path, "index.tsx")));
  if (!sourceRoot) throw new Error("Could not locate the Switchbay source checkout for service installation.");
  const built = await runCommand([bun, "build", join(sourceRoot, "index.tsx"), "--target", "bun", "--outfile", app], sourceRoot);
  if (!built.ok) throw new Error(built.stderr || "Failed to build Switchbay service bundle.");
  try { await readFile(token, "utf8"); } catch { await writeFile(token, randomBytes(32).toString("hex") + "\n", { mode: 0o600 }); }
  await chmod(token, 0o600);
  const providerEnv = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "SWITCHBAY_LMSTUDIO_API_KEY"]
    .flatMap(name => Bun.env[name]?.trim() ? [`${name}=${JSON.stringify(Bun.env[name])}`] : []);
  if (providerEnv.length) { await writeFile(envFile, providerEnv.join("\n") + "\n", { mode: 0o600 }); await chmod(envFile, 0o600); }
  await writeFile(plist, servicePlist(bun), { mode: 0o644 });
  await chmod(plist, 0o644);
  await launchctl(["bootout", `${target}/${LABEL}`], true);
  await launchctl(["bootstrap", target, plist]);
  await launchctl(["enable", `${target}/${LABEL}`]);
  await launchctl(["kickstart", "-k", `${target}/${LABEL}`]);
  await waitUntilReady();
  return `Switchbay API installed and running at http://127.0.0.1:7349.\nToken: ${token}`;
}

async function ensureLoaded() { const result = await runCommand(["launchctl", "print", `${target}/${LABEL}`]); if (!result.ok) await launchctl(["bootstrap", target, plist]); }
async function waitUntilReady() { for (let attempt = 0; attempt < 30; attempt++) { try { if ((await fetch("http://127.0.0.1:7349/health")).ok) return; } catch {} await Bun.sleep(100); } throw new Error(`Switchbay service did not become ready. Check ${join(root, "api.error.log")}.`); }
async function launchctl(args: string[], ignoreFailure = false) { const result = await runCommand(["launchctl", ...args]); if (!result.ok && !ignoreFailure) throw new Error(result.stderr || `launchctl ${args[0]} failed`); }
function servicePlist(bun: string) { const esc = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${esc(bun)}</string><string>${esc(app)}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${esc(join(root, "service"))}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${esc(home)}</string><key>PATH</key><string>${esc(`${join(home, ".bun", "bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string><key>SWITCHBAY_API_HOST</key><string>127.0.0.1</string><key>SWITCHBAY_API_PORT</key><string>7349</string><key>SWITCHBAY_API_TOKEN_FILE</key><string>${esc(token)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${esc(join(root, "api.log"))}</string><key>StandardErrorPath</key><string>${esc(join(root, "api.error.log"))}</string></dict></plist>\n`; }
