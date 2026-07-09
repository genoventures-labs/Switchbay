import path from "node:path";
import fs from "node:fs/promises";
import { userConfigDir, workspaceStorageDir } from "../config/paths";
import { pluginAssetPaths } from "../plugins/registry";

export type BuiltinAgent = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
};

export type AgentSource = "builtin" | "user" | "workspace" | "plugin";

export type Agent = BuiltinAgent & {
  custom?: boolean;
  source?: AgentSource;
  path?: string;
};

export type AgentScope = "user" | "workspace";

export type AgentDefinitionAnswers = {
  name: string;
  specialty: string;
  approach?: string;
  rules?: string;
  scope?: AgentScope;
};

export type AgentDraft = {
  id: string;
  name: string;
  content: string;
  savePath: string;
  scope: AgentScope;
};

export const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    id: "ui-designer",
    name: "UI Designer",
    emoji: "🎨",
    description: "Component architecture, layout, accessibility, design systems",
    prompt: `You are operating as a UI/UX specialist.
Priorities: visual hierarchy, component composition, accessibility (ARIA, keyboard nav, contrast), responsive layout, design-system consistency.
Prefer: semantic HTML, CSS custom properties, composable components, minimal dependencies.
Always call out: missing focus states, hardcoded colors, inaccessible patterns, layout that breaks on mobile.
Avoid: inline styles for anything structural, deeply nested component trees, prop drilling past 2 levels.`,
  },
  {
    id: "backend",
    name: "Backend Engineer",
    emoji: "⚙️",
    description: "API design, DB schema, performance, reliability, auth",
    prompt: `You are operating as a backend systems engineer.
Priorities: API contract correctness, DB schema soundness, query performance, error handling, auth/authz, idempotency.
Prefer: explicit over implicit, typed interfaces at boundaries, early validation, structured logging.
Always call out: N+1 queries, missing indexes, unauthenticated endpoints, unhandled error paths, missing timeouts.
Avoid: business logic in controllers, raw SQL without parameterization, secrets in code.`,
  },
  {
    id: "devops",
    name: "DevOps",
    emoji: "🚀",
    description: "CI/CD, infra, Docker, systemd, deployment, observability",
    prompt: `You are operating as a DevOps / platform engineer.
Priorities: reproducible builds, deployment safety, rollback strategy, observability (logs/metrics/traces), least-privilege.
Prefer: immutable infrastructure, health checks, graceful shutdown, config via env vars, small container images.
Always call out: missing health endpoints, hardcoded ports, no resource limits, missing restart policies, secrets in env output.
Avoid: running as root, latest tags on images, manual steps with no automation equivalent.`,
  },
  {
    id: "debugger",
    name: "Debugger",
    emoji: "🔍",
    description: "Root cause analysis, bisect, reproduction, systematic diagnosis",
    prompt: `You are operating as a systematic debugger.
Priorities: isolate root cause before proposing any fix, never guess, build the smallest reproduction.
Approach: form a hypothesis → identify what would falsify it → test that exact thing → repeat.
Prefer: adding targeted logging/assertions, git bisect for regressions, diff-based analysis.
Always call out: symptoms being confused with root cause, fixes that mask rather than resolve.
Never: suggest refactoring during active debugging — fix first, clean later.`,
  },
  {
    id: "architect",
    name: "Architect",
    emoji: "🏗️",
    description: "System design, tradeoffs, interfaces, long-term structure",
    prompt: `You are operating as a software architect.
Priorities: clean boundaries between components, explicit contracts at interfaces, long-term maintainability over short-term velocity.
Prefer: diagrams-first thinking (describe the shape before writing code), named patterns, clear dependency direction.
Always call out: coupling that will hurt later, missing abstraction layers, decisions that foreclose future options.
Never: implement before the design is agreed — propose, discuss tradeoffs, then build.`,
  },
  {
    id: "security",
    name: "Security",
    emoji: "🔒",
    description: "Threat modeling, OWASP, auth, injection, secrets",
    prompt: `You are operating as a security-focused engineer.
Priorities: attack surface reduction, input validation at all trust boundaries, secrets hygiene, auth/authz correctness.
Threat model every change: who can reach this? what can they send? what can go wrong?
Always check: injection vectors (SQL, shell, path traversal), auth bypasses, insecure defaults, exposed stack traces, missing rate limits.
Flag immediately: any hardcoded secret, credential in log output, unauthenticated mutation endpoint, eval/exec with user input.`,
  },
  {
    id: "docs",
    name: "Tech Writer",
    emoji: "📝",
    description: "Documentation, READMEs, API docs, clear technical writing",
    prompt: `You are operating as a technical writer.
Priorities: accuracy over completeness, reader-first framing, concrete examples over abstract description.
Prefer: short sentences, active voice, code snippets that actually run, explicit prerequisites.
Always include: what this does, why you'd use it, a minimal working example, and what can go wrong.
Avoid: jargon without definition, passive constructions, documenting the obvious, walls of text with no structure.`,
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    emoji: "👁️",
    description: "Thorough code review — correctness, style, edge cases, test gaps",
    prompt: `You are operating as a rigorous code reviewer.
Review every change for: correctness (does it do what it claims?), edge cases, error handling, test coverage gaps, performance implications, security implications, readability.
Structure feedback as: blocking issues first, then suggestions, then nits — clearly labeled.
Be direct and specific. Cite the exact line. Explain the consequence of the issue, not just that it exists.
Praise what's done well — good reviews are balanced, not just a list of problems.`,
  },
];

const CUSTOM_AGENT_DIR = path.join(
  process.env.HOME ?? process.cwd(),
  ".switchbay",
  "agents",
);

export function userAgentDir(): string {
  return path.join(userConfigDir(), "agents");
}

export function workspaceAgentDir(cwd = process.cwd()): string {
  return path.join(workspaceStorageDir(cwd), "agents");
}

export async function loadAllAgents(cwd = process.cwd()): Promise<Agent[]> {
  const agents: Agent[] = BUILTIN_AGENTS.map((agent) => ({ ...agent, source: "builtin" }));
  const dirs = [
    { dir: CUSTOM_AGENT_DIR, source: "user" as const },
    { dir: userAgentDir(), source: "user" as const },
    { dir: workspaceAgentDir(cwd), source: "workspace" as const },
  ];

  for (const { dir, source } of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        try {
          const filePath = path.join(dir, entry.name);
          const content = await fs.readFile(filePath, "utf-8");
          const idFromFile = entry.name.replace(/\.md$/, "");
          // Skip if already a builtin with same id
          if (agents.some(a => a.id === idFromFile)) continue;
          agents.push(parseCustomAgent(content, idFromFile, source, filePath));
        } catch { /* skip malformed */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  for (const agentPath of await pluginAssetPaths("agents")) {
    try {
      const content = await fs.readFile(agentPath, "utf-8");
      const idFromFile = path.basename(agentPath).replace(/\.md$/, "");
      if (agents.some(a => a.id === idFromFile)) continue;
      agents.push(parseCustomAgent(content, idFromFile, "plugin", agentPath));
    } catch {
      // Skip malformed plugin agents.
    }
  }

  return agents;
}

function parseCustomAgent(content: string, idFromFile: string, source: AgentSource = "user", filePath?: string): Agent {
  const lines = content.split("\n");
  const meta = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
    if (match?.[1] && match[2] && isAgentMetaKey(match[1])) {
      meta.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  const nameLine = meta.get("name") ??
    (lines[0]?.startsWith("#") ? lines[0].replace(/^#+\s*/, "").trim() : idFromFile);
  const descLine = meta.get("description") ?? "";
  const prompt = lines
    .filter(l => !l.startsWith("#") && !isAgentMetaLine(l))
    .join("\n")
    .trim();
  return {
    id: meta.get("id") || idFromFile,
    name: nameLine,
    emoji: meta.get("emoji") || "🤖",
    description: descLine || `Custom agent: ${nameLine}`,
    prompt,
    custom: true,
    source,
    path: filePath,
  };
}

function isAgentMetaLine(line: string): boolean {
  const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
  return Boolean(match?.[1] && isAgentMetaKey(match[1]));
}

function isAgentMetaKey(key: string): boolean {
  return key === "id" || key === "name" || key === "emoji" || key === "description";
}

export function slugifyAgentId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "custom-agent";
}

export function buildAgentDefinition(answers: AgentDefinitionAnswers, cwd = process.cwd()): AgentDraft {
  const name = answers.name.trim();
  const specialty = answers.specialty.trim();
  const id = slugifyAgentId(name);
  const scope = answers.scope ?? "workspace";
  const savePath = path.join(scope === "user" ? userAgentDir() : workspaceAgentDir(cwd), `${id}.md`);
  const prompt = formatAgentPrompt({
    name,
    specialty,
    approach: answers.approach?.trim() ?? "",
    rules: answers.rules?.trim() ?? "",
  });
  const content = `# ${name}
id: ${id}
emoji: 🤖
description: ${specialty.slice(0, 140)}

${prompt}
`;

  return { id, name, content, savePath, scope };
}

export async function saveAgentDefinition(answers: AgentDefinitionAnswers, cwd = process.cwd()): Promise<AgentDraft> {
  const draft = buildAgentDefinition(answers, cwd);
  await fs.mkdir(path.dirname(draft.savePath), { recursive: true });
  await fs.writeFile(draft.savePath, draft.content, "utf-8");
  return draft;
}

function formatAgentPrompt(input: { name: string; specialty: string; approach: string; rules: string }): string {
  const role = input.specialty || input.name;
  const lines = [
    `You are operating as a specialist for ${role}.`,
    `Priorities: stay inside the ${input.name} role, improve task quality, surface tradeoffs early, and keep recommendations actionable.`,
    input.approach
      ? `Approach: ${input.approach}`
      : "Approach: inspect the current context first, ask only when blocked, then move decisively.",
    "Prefer: concrete repo-aware advice, focused edits, clear verification steps, and concise handoffs.",
    "Always call out: missing context, risky assumptions, security or data-loss concerns, and test gaps.",
    input.rules
      ? `Hard rules: ${input.rules}`
      : "Avoid: pretending to have capabilities or context that are not available in the session.",
  ];
  return lines.join("\n");
}

export function findAgent(id: string, agents: Agent[]): Agent | undefined {
  return agents.find(a => a.id === id);
}

export function agentSystemPrompt(agent: Agent): string {
  return `\n\nACTIVE AGENT: ${agent.emoji} ${agent.name}\n${agent.prompt}`;
}
