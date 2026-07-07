import path from "node:path";
import fs from "node:fs/promises";

type Args = Record<string, string | boolean>;

const STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "before", "being",
  "between", "could", "every", "for", "from", "have", "help", "helps",
  "helping", "into", "just", "like", "make", "more", "most", "need", "not",
  "over", "that", "their", "them", "then", "there", "these", "they", "this",
  "through", "want", "when", "where", "who", "with", "would", "your",
]);

async function main() {
  const [tool, ...rest] = Bun.argv.slice(2);
  const args = parseArgs(rest);

  if (!tool || tool === "help" || tool === "--help") {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const result = await runTool(tool, args, cwd);
  console.log(result.trim());
}

async function runTool(tool: string, args: Args, cwd: string): Promise<string> {
  switch (tool) {
    case "brief":
      return saveCreativeOutput(cwd, "briefs", "brief", buildBrief(required(args, "notes")));
    case "packet":
      return saveCreativeOutput(cwd, "packets", "packet", buildCreativePacket(
        required(args, "brief"),
        stringArg(args.audience, "the target audience"),
        stringArg(args.format, "post"),
        numberArg(args.days, 7),
      ));
    case "name-storm":
      return buildNameStorm(required(args, "brief"), numberArg(args.count, 12));
    case "positioning-routes":
      return buildPositioningRoutes(required(args, "brief"));
    case "hook-bank":
      return buildHookBank(required(args, "topic"), stringArg(args.audience, "the target audience"), stringArg(args.format, "post"));
    case "copy-draft":
      return saveCreativeOutput(cwd, "drafts", "copy", buildCopyDraft(required(args, "brief"), stringArg(args.format, "post")));
    case "rewrite-voice":
      return rewriteVoice(required(args, "text"), stringArg(args.voice, "direct"), cwd);
    case "tighten":
      return tightenCopy(required(args, "text"));
    case "expand-idea":
      return buildIdeaExpansion(required(args, "idea"));
    case "critique":
      return critiqueCopy(required(args, "text"));
    case "content-calendar":
      return saveCreativeOutput(cwd, "drafts", "calendar", buildContentCalendar(required(args, "theme"), numberArg(args.days, 7)));
    case "list-voices":
      return listVoices(cwd);
    case "read-voice":
      return readVoice(cwd, required(args, "voice"));
    default:
      throw new Error(`Unknown creative tool: ${tool}`);
  }
}

function buildBrief(notes: string): string {
  const keywords = topKeywords(notes).slice(0, 8);
  return [
    "# Creative Brief",
    "",
    "## Raw Notes",
    notes.trim(),
    "",
    "## Working Objective",
    `Turn this into a clear, audience-aware creative output around: ${keywords.slice(0, 4).join(", ") || "the core idea"}.`,
    "",
    "## Audience",
    "- Primary: people already close enough to care, but not yet clear enough to act.",
    "- Secondary: colder readers who need a fast reason to keep reading.",
    "",
    "## Promise",
    `A useful, specific result connected to ${keywords[0] ?? "the main idea"}.`,
    "",
    "## Tone",
    "- Clear",
    "- Practical",
    "- Confident",
    "- Human",
    "",
    "## Proof To Find",
    "- Concrete examples",
    "- Before and after contrast",
    "- Specific use cases",
    "- Language the audience already uses",
    "",
    "## Creative Constraints",
    "- Avoid inflated claims.",
    "- Avoid generic inspiration-speak.",
    "- Make the first line carry weight.",
    "- Keep the call to action simple.",
  ].join("\n");
}

function buildCreativePacket(brief: string, audience: string, format: string, days: number): string {
  const normalizedBrief = brief.trim();
  const topic = topKeywords(normalizedBrief).slice(0, 4).join(", ") || normalizedBrief;
  return [
    "# Creative Packet",
    "",
    "## Source Brief",
    normalizedBrief,
    "",
    buildBrief(normalizedBrief),
    "",
    buildPositioningRoutes(normalizedBrief),
    "",
    buildNameStorm(normalizedBrief, 12),
    "",
    buildHookBank(topic, audience, format),
    "",
    buildCopyDraft(normalizedBrief, format),
    "",
    buildContentCalendar(topic, days),
    "",
    "## Next Moves",
    "- Pick one positioning route.",
    "- Cut the name list to three serious candidates.",
    "- Turn the strongest hook into the first draft.",
    "- Run critique after the draft has a concrete CTA.",
  ].join("\n");
}

function buildNameStorm(brief: string, count: number): string {
  const words = topKeywords(brief);
  const anchors = words.length ? words : ["signal", "forge", "north", "field", "craft"];
  const prefixes = ["Clear", "North", "True", "Field", "Signal", "Forge", "Common", "Bright", "Anchor", "Prime"];
  const suffixes = ["Works", "Lab", "Kit", "Stack", "Signal", "Field", "House", "Bay", "Press", "Pilot"];
  const names: string[] = [];

  for (const word of anchors) {
    names.push(titleCase(word));
    names.push(`${titleCase(word)} ${suffixes[names.length % suffixes.length]}`);
    names.push(`${prefixes[names.length % prefixes.length]} ${titleCase(word)}`);
    if (names.length >= count) break;
  }

  while (names.length < count) {
    names.push(`${prefixes[names.length % prefixes.length]} ${suffixes[names.length % suffixes.length]}`);
  }

  return [
    "# Name Storm",
    "",
    ...names.slice(0, count).map((name, index) => `${index + 1}. **${name}** - ${nameRationale(name)}`),
    "",
    "## Watchouts",
    "- Check domain/social availability.",
    "- Search for same-category conflicts.",
    "- Say it out loud before trusting it.",
  ].join("\n");
}

function buildPositioningRoutes(brief: string): string {
  const keyword = topKeywords(brief)[0] ?? "the work";
  const routes: Array<[string, string]> = [
    ["Outcome-first", `Lead with the practical result this creates around ${keyword}.`],
    ["Enemy-first", "Define the frustrating old way and make the alternative feel obvious."],
    ["Identity-first", "Frame it as the tool for a specific kind of operator or builder."],
    ["Control-first", "Emphasize independence, ownership, portability, and fewer dependencies."],
    ["Craft-first", "Make the quality of the method the reason to believe."],
    ["Speed-first", "Lead with momentum, fewer steps, and faster iteration."],
    ["Trust-first", "Lead with safety, reliability, and fewer surprises."],
  ];
  return [
    "# Positioning Routes",
    "",
    ...routes.map(([name, body]) => `## ${name}\n${body}\n\nTagline shape: **${taglineShape(name, keyword)}**`),
  ].join("\n");
}

function buildHookBank(topic: string, audience: string, format: string): string {
  const hooks = [
    `Most ${audience} do not need more ideas. They need a cleaner way to use ${topic}.`,
    `The mistake is treating ${topic} like a motivation problem.`,
    `If ${topic} keeps slipping, the system is probably too vague.`,
    `Here is the quiet part about ${topic}: clarity beats intensity.`,
    `A better ${format} starts before the first sentence.`,
    `The fastest way to improve ${topic} is to remove one decision.`,
    `This is for the ${audience} who are tired of rebuilding the same workflow.`,
    `${topic} gets easier when the next move is already named.`,
    `Stop asking "what should I make?" Ask "what should this help someone do?"`,
    `The useful version of ${topic} is smaller, sharper, and easier to repeat.`,
  ];
  return ["# Hook Bank", "", ...hooks.map((hook, index) => `${index + 1}. ${hook}`)].join("\n");
}

function buildCopyDraft(brief: string, format: string): string {
  const keywords = topKeywords(brief);
  const subject = keywords.slice(0, 3).join(", ") || "the offer";
  if (format.toLowerCase().includes("email")) {
    return [
      "# Email Draft",
      "",
      `Subject: A cleaner way to handle ${keywords[0] ?? "the work"}`,
      "",
      `You do not need a bigger system. You need a clearer next move around ${subject}.`,
      "",
      "That is the point here: take the scattered pieces, name the job, and turn it into something you can actually use.",
      "",
      "If this is useful, the next step is simple: start with the roughest version and make it concrete.",
    ].join("\n");
  }
  return [
    `# ${titleCase(format)} Draft`,
    "",
    `The problem is not that ${subject} is impossible. It is that the path usually stays too fuzzy for too long.`,
    "",
    "This gives the work a shape: what it is, who it is for, why it matters, and what should happen next.",
    "",
    "Use it when you need fewer loose ideas and more usable direction.",
  ].join("\n");
}

async function rewriteVoice(text: string, voice: string, cwd: string): Promise<string> {
  const voiceDoc = await readVoiceIfExists(cwd, voice);
  const guidance = voiceDoc
    ? `Voice notes found for ${voice}:\n${voiceDoc}`
    : `Voice direction: ${voice}.`;
  return [
    "# Rewrite Voice Pass",
    "",
    guidance,
    "",
    "## Rewrite",
    tightenCopy(text)
      .replace(/\butilize\b/gi, "use")
      .replace(/\bleverage\b/gi, "use")
      .replace(/\bin order to\b/gi, "to"),
  ].join("\n");
}

function tightenCopy(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/\s+/g, " ")
      .replace(/\bvery\b\s*/gi, "")
      .replace(/\breally\b\s*/gi, "")
      .replace(/\bjust\b\s*/gi, "")
      .replace(/\bkind of\b\s*/gi, "")
      .replace(/\bsort of\b\s*/gi, ""))
    .join("\n");
}

function buildIdeaExpansion(idea: string): string {
  const keywords = topKeywords(idea).slice(0, 5);
  return [
    "# Idea Expansion",
    "",
    "## Core Idea",
    idea.trim(),
    "",
    "## Content Pillars",
    ...keywords.map((keyword) => `- ${titleCase(keyword)}: explain, prove, contrast, and operationalize it.`),
    "",
    "## Useful Formats",
    "- Short post",
    "- Practical checklist",
    "- Behind-the-scenes note",
    "- Opinionated teardown",
    "- Before/after example",
    "",
    "## Next Draft Prompt",
    `Write a practical first draft that helps the reader understand ${keywords[0] ?? "the idea"} without hype.`,
  ].join("\n");
}

function critiqueCopy(text: string): string {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const hasCta = /\b(start|try|use|buy|join|read|watch|reply|book|download|sign up)\b/i.test(text);
  const longSentences = text.split(/[.!?]/).filter((sentence) => sentence.trim().split(/\s+/).length > 28).length;
  return [
    "# Copy Critique",
    "",
    `Word count: ${wordCount}`,
    `Call to action: ${hasCta ? "present" : "missing or too soft"}`,
    `Long sentence risk: ${longSentences}`,
    "",
    "## Notes",
    `- Opening strength: ${text.trim().length > 0 ? "usable, but test whether the first line creates immediate tension." : "missing."}`,
    `- Clarity: ${wordCount > 180 ? "consider cutting or splitting into sections." : "likely manageable."}`,
    `- Specificity: add concrete nouns, numbers, or examples if it feels floaty.`,
    `- Cringe risk: remove inflated adjectives before adding more claims.`,
    "",
    "## Best Next Move",
    hasCta ? "Tighten the first line and sharpen the proof." : "Add a simple next step for the reader.",
  ].join("\n");
}

function buildContentCalendar(theme: string, days: number): string {
  const formats = ["teardown", "checklist", "story", "opinion", "example", "prompt", "recap"];
  const totalDays = Math.max(1, Math.min(days, 31));
  const rows = Array.from({ length: totalDays }, (_, index) => {
    const format = formats[index % formats.length] ?? "teardown";
    return `Day ${index + 1}: **${titleCase(format)}** - ${calendarPrompt(theme, format)}`;
  });
  return ["# Content Calendar", "", `Theme: ${theme}`, "", ...rows].join("\n");
}

async function listVoices(cwd: string): Promise<string> {
  const dir = path.join(cwd, ".switchbay", "creative", "voices");
  try {
    const entries = await fs.readdir(dir);
    const voices = entries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.replace(/\.md$/, ""));
    return voices.length ? voices.join("\n") : "No voices found.";
  } catch {
    return "No voices found. Add markdown files to .switchbay/creative/voices.";
  }
}

async function readVoice(cwd: string, voice: string): Promise<string> {
  return await readVoiceIfExists(cwd, voice) ?? `Voice not found: ${voice}`;
}

async function readVoiceIfExists(cwd: string, voice: string): Promise<string | null> {
  const safeName = voice.replace(/[^a-zA-Z0-9_-]/g, "-");
  const filePath = path.join(cwd, ".switchbay", "creative", "voices", `${safeName}.md`);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function saveCreativeOutput(cwd: string, kind: string, label: string, content: string): Promise<string> {
  const dir = path.join(cwd, ".switchbay", "creative", kind);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.md`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content, "utf-8");
  return `${content}\n\nSaved: ${path.relative(cwd, filePath)}`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function required(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
  }
  return value;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberArg(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function topKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 20);
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function nameRationale(name: string): string {
  if (/\bLab\b/.test(name)) return "signals experimentation and iteration.";
  if (/\bBay\b/.test(name)) return "suggests a place where parts connect.";
  if (/\bWorks\b/.test(name)) return "feels practical and production-minded.";
  if (/\bSignal\b/.test(name)) return "points toward clarity and pattern recognition.";
  return "short enough to test and flexible enough to position.";
}

function taglineShape(route: string, keyword: string): string {
  const shapes: Record<string, string> = {
    "Outcome-first": `Get clearer ${keyword} without rebuilding the whole system.`,
    "Enemy-first": `Stop letting scattered ${keyword} decide the day.`,
    "Identity-first": `For builders who want ${keyword} to feel usable.`,
    "Control-first": `Keep ${keyword} close to the work and under your control.`,
    "Craft-first": `Sharper ${keyword}, built from better practice.`,
    "Speed-first": `Move from fuzzy ${keyword} to usable next steps.`,
    "Trust-first": `A steadier way to handle ${keyword}.`,
  };
  return shapes[route] ?? `A clearer way to handle ${keyword}.`;
}

function calendarPrompt(theme: string, format: string): string {
  const prompts: Record<string, string> = {
    teardown: `Break down one mistake people make around ${theme}.`,
    checklist: `Give the reader a short checklist for ${theme}.`,
    story: `Tell a small before/after story about ${theme}.`,
    opinion: `Take a clear stance on ${theme}.`,
    example: `Show a concrete example of ${theme} in action.`,
    prompt: `Give the audience a prompt they can use for ${theme}.`,
    recap: `Summarize what changed after applying ${theme}.`,
  };
  return prompts[format] ?? `Make ${theme} useful.`;
}

function printHelp() {
  console.log([
    "Creative Engine",
    "",
    "Tools:",
    "  brief --notes <text>",
    "  packet --brief <text> [--audience <text>] [--format post] [--days 7]",
    "  name-storm --brief <text> [--count 12]",
    "  positioning-routes --brief <text>",
    "  hook-bank --topic <text> [--audience <text>] [--format <text>]",
    "  copy-draft --brief <text> [--format post]",
    "  rewrite-voice --text <text> [--voice direct]",
    "  tighten --text <text>",
    "  expand-idea --idea <text>",
    "  critique --text <text>",
    "  content-calendar --theme <text> [--days 7]",
    "  list-voices",
    "  read-voice --voice <name>",
  ].join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
