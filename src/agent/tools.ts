import type { OriClient } from "../runtime/ori-client";
import type { OriCapabilityName } from "../runtime/types";
import path from "node:path";
import type { DraftEdit } from "./turn-state";
import { readWorkspaceFile } from "../tools/files";
import { getGitStatusSummary, getRecentGitLog } from "../tools/git";
import { getDiffSummary } from "../tools/patch";
import { runVerification } from "../tools/verify";

export type LocalCapabilityName =
  | "read_file"
  | "draft_edit"
  | "workspace_summary"
  | "list_files"
  | "git_status"
  | "git_log"
  | "diff_stat"
  | "verify";

export type AgentToolName = `local:${LocalCapabilityName}` | `ori:${OriCapabilityName}`;

export type AgentToolCall = {
  args?: Record<string, unknown>;
  tool: AgentToolName;
};

export type AgentToolExecution = {
  draft?: DraftEdit;
  ok: boolean;
  summary: string;
  tool: AgentToolName;
};

const TOOL_BLOCK_PATTERN = /<ori-tool>([\s\S]*?)<\/ori-tool>/i;

export function getToolSystemPrompt(): string {
  return [
    "You are operating inside ORI Code, a local coding agent shell connected to the user's repository.",
    "You are not a generic remote chatbot. Assume local repo access is available through ORI Code's machine-gated capabilities.",
    "You may use safe capabilities before answering.",
    "If a tool is needed, respond with only one XML block in this exact format and nothing else:",
    "<ori-tool>{\"tool\":\"local:read_file\",\"args\":{\"path\":\"src/index.ts\"}}</ori-tool>",
    "Available safe capabilities:",
    "Local capabilities (machine-gated by ORI Code):",
    "- local:read_file args: {\"path\":\"relative/path\"}",
    "- local:draft_edit args: {\"path\":\"relative/path\",\"instruction\":\"change to make\"}",
    "- local:workspace_summary args: {}",
    "- local:list_files args: {}",
    "- local:git_status args: {}",
    "- local:git_log args: {}",
    "- local:diff_stat args: {}",
    "- local:verify args: {}",
    "ORI-native capabilities (cognition-only, no machine writes):",
    "- ori:memory_lookup args: {\"prompt\":\"question\"}",
    "- ori:plan_review args: {\"prompt\":\"plan to critique\"}",
    "- ori:repo_research args: {\"prompt\":\"research goal\"}",
    "- ori:web_search args: {\"prompt\":\"search query\"}",
    "- ori:web_fetch args: {\"prompt\":\"https://example.com\"}",
    "- ori:research args: {\"prompt\":\"research goal\"}",
    "- ori:repo_report args: {\"prompt\":\"summarize this repo\"}",
    "- ori:ask_ori args: {\"prompt\":\"question\"}",
    "Rules:",
    "- Use at most one tool per response.",
    "- After you receive a tool result, either ask for another tool or give the final answer.",
    "- Do not invent tool results.",
    "- Prefer ORI-native capabilities for reasoning support and local capabilities for repo inspection.",
    "- If the user asks about repo facts like syntax, framework, package manager, scripts, config, dependencies, or project structure, inspect first with local:workspace_summary or local:read_file before answering.",
    "- Do not answer repository fact questions from guesswork when a local inspection tool can confirm them.",
    "- You can help modify or generate files by proposing edits for ORI Code's draft/apply workflow.",
    "- Do not claim you cannot access the local repo when local inspection or draft-edit flows are available.",
    "- Be explicit about approval boundaries: inspections are available, draft edits are available, and applying or higher-risk actions may require user approval.",
    "- When the user asks you to change, update, create, refactor, or generate files/code, prefer local:draft_edit over just describing the change.",
  ].join("\n");
}

export function extractToolCall(content: string): AgentToolCall | null {
  const match = content.match(TOOL_BLOCK_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as AgentToolCall;
    if (!parsed.tool) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function executeAgentTool(
  call: AgentToolCall,
  input: {
    client?: OriClient;
    profile?: string;
    cwd?: string;
    recentFiles?: string[];
    sessionId?: string;
    surface?: string;
  } = {},
): Promise<AgentToolExecution> {
  const cwd = input.cwd ?? process.cwd();

  switch (call.tool) {
    case "local:read_file": {
      const path = typeof call.args?.path === "string" ? call.args.path : "";
      if (!path) {
        return {
          ok: false,
          summary: "Missing required read_file arg: path",
          tool: call.tool,
        };
      }

      try {
        const file = await readWorkspaceFile(path, cwd);
        return {
          ok: true,
          summary: `FILE ${path}\n\n${file.content}`,
          tool: call.tool,
        };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
          tool: call.tool,
        };
      }
    }
    case "local:list_files":
      return {
        ok: true,
        summary:
          input.recentFiles && input.recentFiles.length > 0
            ? `FILES\n\n${input.recentFiles.join("\n")}`
            : "FILES\n\nNo recent files available.",
        tool: call.tool,
      };
    case "local:workspace_summary": {
      const summary = await buildWorkspaceSummary(cwd, input.recentFiles);
      return {
        ok: true,
        summary,
        tool: call.tool,
      };
    }
    case "local:git_status":
      return {
        ok: true,
        summary: await getGitStatusSummary(cwd),
        tool: call.tool,
      };
    case "local:git_log":
      return {
        ok: true,
        summary: await getRecentGitLog(cwd),
        tool: call.tool,
      };
    case "local:diff_stat": {
      const diff = await getDiffSummary(cwd);
      return {
        ok: true,
        summary: diff.stat,
        tool: call.tool,
      };
    }
    case "local:verify": {
      const verification = await runVerification(cwd);
      return {
        ok: verification.ok,
        summary: [
          verification.summary,
          verification.stdout || verification.stderr || "No output.",
        ].join("\n\n"),
        tool: call.tool,
      };
    }
    case "ori:memory_lookup":
    case "ori:plan_review":
    case "ori:web_search":
    case "ori:web_fetch":
    case "ori:research":
    case "ori:repo_report":
    case "ori:repo_research":
    case "ori:ask_ori": {
      if (!input.client || !input.surface) {
        return {
          ok: false,
          summary: `Missing ORI client context for ${call.tool}.`,
          tool: call.tool,
        };
      }

      const prompt =
        typeof call.args?.prompt === "string"
          ? call.args.prompt
          : "Use the current session context and help with this turn.";
      const capability = call.tool.replace("ori:", "") as OriCapabilityName;
      const result = await input.client.invokeCapability({
        capability,
        profile: input.profile,
        prompt,
        sessionId: input.sessionId,
        surface: input.surface,
      });

      return {
        ok: true,
        summary: result || `No output returned from ${call.tool}.`,
        tool: call.tool,
      };
    }
    default:
      return {
        ok: false,
        summary: `Unsupported tool: ${String(call.tool)}`,
        tool: call.tool,
      };
  }
}

async function buildWorkspaceSummary(cwd: string, recentFiles?: string[]) {
  const packageJson = await tryReadWorkspaceFile("package.json", cwd);
  const tsconfig = await tryReadWorkspaceFile("tsconfig.json", cwd);
  const agents = await tryReadWorkspaceFile("AGENTS.md", cwd);

  let packageSummary = "package.json: not found";
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as {
        name?: string;
        type?: string;
        module?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const dependencies = Object.keys(parsed.dependencies ?? {}).slice(0, 8);
      const devDependencies = Object.keys(parsed.devDependencies ?? {}).slice(0, 8);
      const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 8);

      packageSummary = [
        `package.json name: ${parsed.name ?? "unknown"}`,
        `package type: ${parsed.type ?? "unspecified"}`,
        `module entry: ${parsed.module ?? "unspecified"}`,
        `scripts: ${scripts.length > 0 ? scripts.join(", ") : "none"}`,
        `dependencies: ${dependencies.length > 0 ? dependencies.join(", ") : "none"}`,
        `devDependencies: ${devDependencies.length > 0 ? devDependencies.join(", ") : "none"}`,
      ].join("\n");
    } catch {
      packageSummary = "package.json: present but could not be parsed";
    }
  }

  const tsconfigSummary = tsconfig
    ? [
        "tsconfig.json:",
        ...tsconfig
          .split("\n")
          .slice(0, 24),
      ].join("\n")
    : "tsconfig.json: not found";

  const agentsSummary = agents
    ? [
        "AGENTS.md:",
        ...agents
          .split("\n")
          .slice(0, 24),
      ].join("\n")
    : "AGENTS.md: not found";

  const fileHints = recentFiles && recentFiles.length > 0
    ? `recent files: ${recentFiles.slice(0, 12).join(", ")}`
    : "recent files: unavailable";

  return [
    "WORKSPACE SUMMARY",
    packageSummary,
    tsconfigSummary,
    agentsSummary,
    fileHints,
    `cwd: ${cwd}`,
    `project: ${path.basename(cwd)}`,
  ].join("\n\n");
}

async function tryReadWorkspaceFile(targetPath: string, cwd: string) {
  try {
    const file = await readWorkspaceFile(targetPath, cwd);
    return file.content;
  } catch {
    return null;
  }
}
