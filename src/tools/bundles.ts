import path from "node:path";
import fs from "node:fs/promises";

export type BundleManifest = {
  name: string;
  id: string;
  description: string;
  version: string;
};

export type Bundle = {
  manifest: BundleManifest;
  rules: string;
  path: string;
};

const GLOBAL_BUNDLE_DIR = path.join(
  Bun.env.HOME ?? process.env.HOME ?? process.cwd(),
  ".ori",
  "bundles",
);

const LOCAL_BUNDLE_DIR = path.join(process.cwd(), ".ori", "bundles");

export async function listAvailableBundles(): Promise<Bundle[]> {
  const bundles: Bundle[] = [];
  const dirs = [GLOBAL_BUNDLE_DIR, LOCAL_BUNDLE_DIR];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const bundlePath = path.join(dir, entry.name);
          const manifestPath = path.join(bundlePath, "manifest.json");
          const rulesPath = path.join(bundlePath, "rules.md");

          if (await fs.stat(manifestPath).catch(() => null)) {
            try {
              const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as BundleManifest;
              let rules = "";
              if (await fs.stat(rulesPath).catch(() => null)) {
                rules = await fs.readFile(rulesPath, "utf-8");
              }
              bundles.push({ manifest, rules, path: bundlePath });
            } catch (e) {
              // Skip malformed bundles
            }
          }
        }
      }
    } catch (e) {
      // Directory doesn't exist, skip
    }
  }

  return bundles;
}
