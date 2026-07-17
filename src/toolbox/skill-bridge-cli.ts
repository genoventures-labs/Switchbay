import { importSkill, previewSkillImport, type SkillImportMode, type SkillProvider } from "./skill-bridge";

const [action, sourcePath, providerArg = "auto", modeArg = "preserve"] = Bun.argv.slice(2);
if (!action || !["preview", "import", "status"].includes(action)) fail("Usage: skill-bridge-cli.ts <status|preview|import> [path] [auto|openai|claude|gemini|generic] [preserve|convert]");

if (action === "status") {
  console.log(JSON.stringify({ ok: true, engine: "skill-bridge", version: "1.0.0", tools: ["status", "preview_skill_import", "import_skill"] }));
  process.exit(0);
}

if (!sourcePath) fail("Usage: skill-bridge-cli.ts <preview|import> <path> [auto|openai|claude|gemini|generic] [preserve|convert]");
const provider = providerArg as SkillProvider;
const mode = modeArg as SkillImportMode;
if (!["auto", "openai", "claude", "gemini", "generic"].includes(provider)) fail(`Unsupported provider: ${provider}`);
if (!["preserve", "convert"].includes(mode)) fail(`Unsupported mode: ${mode}`);

try {
  const result = action === "preview"
    ? await previewSkillImport({ sourcePath, provider, mode })
    : await importSkill({ sourcePath, provider, mode });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function fail(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
