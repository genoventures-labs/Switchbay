import type { OriClient } from "../runtime/ori-client";
import type { ToolDefinition } from "../runtime/types";
import type { OriCapabilityName } from "../runtime/types";
import path from "node:path";
import { formatWorkspaceContext } from "../session/workspace";
import type { WorkspaceSnapshot } from "../session/workspace";
import type { DraftEdit } from "./turn-state";
import { readWorkspaceFile, writeWorkspaceFile } from "../tools/files";
import { getGitStatusSummary, getRecentGitLog } from "../tools/git";
import { buildPatchPreview, getDiffSummary } from "../tools/patch";
import { runCommand } from "../tools/shell";
import { runVerification } from "../tools/verify";
import { fuzzyMatchLocations, listTravelLocations, travelTo } from "../tools/travel";

export type LocalToolName =
  | "read_file"
  | "draft_edit"
  | "create_file"
  | "write_file"
  | "append_file"
  | "replace_in_file"
  | "search_files"
  | "workspace_summary"
  | "list_files"
  | "git_status"
  | "git_log"
  | "diff_stat"
  | "verify"
  | "memory_lookup"
  | "plan_review"
  | "repo_research"
  | "web_search"
  | "web_fetch"
  | "research"
  | "repo_report"
  | "ask_ori"
  | "travel_to"
  | "list_locations";

export type AgentToolExecution = {
  draft?: DraftEdit;
  changedFile?: string;
  ok: boolean;
  patch?: import("../tools/patch").PatchPreview;
  summary: string;
  tool: string;
  /** Set when the tool performed a workspace travel — carries the new location info */
  travel?: {
    toPath: string;
    label: string;
    workspace: import("../session/workspace").WorkspaceSnapshot | null;
  };
};

/**
 * Native OpenAI-format tool definitions sent with every request.
 * The model decides when to call them and returns structured tool_calls.
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the local repository.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file from the project root." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_edit",
      description:
        "Propose an edit to a file. The edit is staged for user approval before being written — it does not modify the file directly.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to edit." },
          instruction: {
            type: "string",
            description: "Plain-language description of the change to make.",
          },
        },
        required: ["path", "instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Create a new file in the current workspace. Fails if the file already exists. Use write_file to overwrite.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the new file." },
          content: { type: "string", description: "Initial file contents." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write full contents to a file in the current workspace immediately. Creates the file if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to write." },
          content: { type: "string", description: "Complete file contents to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search the current workspace for text matches using ripgrep and return matching file:line results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex to search for." },
          glob: { type: "string", description: "Optional glob filter like '*.ts' or 'src/**'." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description: "Append text to the end of a file in the current workspace immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to append to." },
          content: { type: "string", description: "Text to append." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description:
        "Replace an exact substring inside a file in the current workspace immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to modify." },
          find: { type: "string", description: "Exact text to find." },
          replace: { type: "string", description: "Replacement text." },
        },
        required: ["path", "find", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List recently active files in the project.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_summary",
      description:
        "Get a structured summary of the project: package.json, tsconfig, AGENTS.md, recent files, and cwd.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Get the current git status — branch, dirty files, staged changes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Get recent git commit history.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_stat",
      description: "Get a summary of current uncommitted diffs.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "verify",
      description: "Run the project test suite and return results.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_lookup",
      description: "Query ORI's episodic memory for prior context, constraints, or continuity hints.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What to look up in memory." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Search query." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch and read the contents of a URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "URL to fetch." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_review",
      description: "Ask ORI's planning layer to critique a proposed plan and surface risks.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The plan to review." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_research",
      description: "Research a goal or question against the current repository context.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Research goal or question." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_locations",
      description:
        "List all whitelisted and auto-discovered locations ORI is permitted to travel to.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "travel_to",
      description:
        "Travel to a different whitelisted workspace directory. Changes the active working directory and reloads workspace context. Use when the user asks to hop, switch, or move to another project or directory.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Name or partial path of the destination (e.g. 'vuln.ai', 'ori-code', '~/projects/foo'). Will be fuzzy-matched against whitelisted locations.",
          },
        },
        required: ["query"],
      },
    },
  },
];

/**
 * Execute a tool call by name with parsed arguments.
 * Returns a string result to be sent back as a tool role message.
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  input: {
    client?: OriClient;
    profile?: string;
    cwd?: string;
    recentFiles?: string[];
    sessionId?: string;
    surface?: string;
    workspace?: WorkspaceSnapshot | null;
  } = {},
): Promise<AgentToolExecution> {
  const cwd = input.cwd ?? process.cwd();

  switch (name as LocalToolName) {
    case "read_file": {
      const filePath = typeof args.path === "string" ? args.path : "";
      if (!filePath) {
        return { ok: false, summary: "read_file: missing required arg 'path'", tool: name };
      }
      try {
        const file = await readWorkspaceFile(filePath, cwd);
        return { ok: true, summary: `FILE ${filePath}\n\n${file.content}`, tool: name };
      } catch (error) {
        return {
          ok: false,
          summary: `read_file failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
          tool: name,
        };
      }
    }

    case "draft_edit": {
      // draft_edit is handled specially in the loop — returns a DraftEdit, not a string result
      return {
        ok: true,
        summary: `Draft edit staged for ${typeof args.path === "string" ? args.path : "unknown"}.`,
        tool: name,
      };
    }

    case "create_file": {
      const targetPath = typeof args.path === "string" ? args.path.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!targetPath) {
        return { ok: false, summary: "create_file: missing required arg 'path'", tool: name };
      }

      const existing = await readWorkspaceFile(targetPath, cwd).then(() => true).catch(() => false);
      if (existing) {
        return {
          ok: false,
          summary: `create_file: ${targetPath} already exists. Use write_file to overwrite it.`,
          tool: name,
        };
      }

      await writeWorkspaceFile(targetPath, content, cwd);
      const patch = await buildPatchPreview({
        before: "",
        after: content,
        cwd,
        targetPath,
      });

      return {
        ok: true,
        changedFile: targetPath,
        patch,
        summary: `CREATED ${targetPath}\n\n${patch.diff}`,
        tool: name,
      };
    }

    case "write_file": {
      const targetPath = typeof args.path === "string" ? args.path.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!targetPath) {
        return { ok: false, summary: "write_file: missing required arg 'path'", tool: name };
      }

      const before = await readWorkspaceFile(targetPath, cwd)
        .then((file) => file.content)
        .catch(() => "");
      await writeWorkspaceFile(targetPath, content, cwd);
      const patch = await buildPatchPreview({
        before,
        after: content,
        cwd,
        targetPath,
      });

      return {
        ok: true,
        changedFile: targetPath,
        patch,
        summary: `WROTE ${targetPath}\n\n${patch.diff}`,
        tool: name,
      };
    }

    case "append_file": {
      const targetPath = typeof args.path === "string" ? args.path.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!targetPath) {
        return { ok: false, summary: "append_file: missing required arg 'path'", tool: name };
      }

      const existing = await readWorkspaceFile(targetPath, cwd).catch(() => ({
        absolutePath: targetPath,
        content: "",
      }));
      const nextContent = `${existing.content}${content}`;
      await writeWorkspaceFile(targetPath, nextContent, cwd);
      const patch = await buildPatchPreview({
        before: existing.content,
        after: nextContent,
        cwd,
        targetPath,
      });

      return {
        ok: true,
        changedFile: targetPath,
        patch,
        summary: `APPENDED ${targetPath}\n\n${patch.diff}`,
        tool: name,
      };
    }

    case "replace_in_file": {
      const targetPath = typeof args.path === "string" ? args.path.trim() : "";
      const find = typeof args.find === "string" ? args.find : "";
      const replace = typeof args.replace === "string" ? args.replace : "";
      if (!targetPath) {
        return { ok: false, summary: "replace_in_file: missing required arg 'path'", tool: name };
      }
      if (!find) {
        return { ok: false, summary: "replace_in_file: missing required arg 'find'", tool: name };
      }

      const existing = await readWorkspaceFile(targetPath, cwd);
      if (!existing.content.includes(find)) {
        return {
          ok: false,
          summary: `replace_in_file: target text was not found in ${targetPath}.`,
          tool: name,
        };
      }
      const nextContent = existing.content.replace(find, replace);
      await writeWorkspaceFile(targetPath, nextContent, cwd);
      const patch = await buildPatchPreview({
        before: existing.content,
        after: nextContent,
        cwd,
        targetPath,
      });

      return {
        ok: true,
        changedFile: targetPath,
        patch,
        summary: `UPDATED ${targetPath}\n\n${patch.diff}`,
        tool: name,
      };
    }

    case "search_files": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const glob = typeof args.glob === "string" ? args.glob.trim() : "";
      if (!query) {
        return { ok: false, summary: "search_files: missing required arg 'query'", tool: name };
      }

      const command = glob
        ? ["rg", "-n", "-g", glob, query]
        : ["rg", "-n", query];
      const result = await runCommand(command, cwd);

      if (!result.ok && !result.stdout) {
        return {
          ok: true,
          summary: `SEARCH RESULTS\n\nNo matches for ${JSON.stringify(query)}.`,
          tool: name,
        };
      }

      const lines = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 80);

      return {
        ok: true,
        summary: lines.length > 0
          ? `SEARCH RESULTS\n\n${lines.join("\n")}`
          : `SEARCH RESULTS\n\nNo matches for ${JSON.stringify(query)}.`,
        tool: name,
      };
    }

    case "list_files":
      return {
        ok: true,
        summary:
          input.recentFiles && input.recentFiles.length > 0
            ? `FILES\n\n${input.recentFiles.join("\n")}`
            : "FILES\n\nNo recent files available.",
        tool: name,
      };

    case "workspace_summary": {
      const summary = await buildWorkspaceSummary(cwd, input.recentFiles);
      return { ok: true, summary, tool: name };
    }

    case "git_status":
      return { ok: true, summary: await getGitStatusSummary(cwd), tool: name };

    case "git_log":
      return { ok: true, summary: await getRecentGitLog(cwd), tool: name };

    case "diff_stat": {
      const diff = await getDiffSummary(cwd);
      return { ok: true, summary: diff.stat, tool: name };
    }

    case "verify": {
      const verification = await runVerification(cwd);
      return {
        ok: verification.ok,
        summary: [verification.summary, verification.stdout || verification.stderr || "No output."].join(
          "\n\n",
        ),
        tool: name,
      };
    }

    case "memory_lookup":
    case "plan_review":
    case "web_search":
    case "web_fetch":
    case "research":
    case "repo_report":
    case "repo_research":
    case "ask_ori": {
      if (!input.client || !input.surface) {
        return { ok: false, summary: `Missing ORI client context for ${name}.`, tool: name };
      }
      const prompt =
        typeof args.prompt === "string" ? args.prompt : "Use current session context.";
      const result = await input.client.invokeCapability({
        capability: name as OriCapabilityName,
        profile: input.profile,
        prompt,
        sessionId: input.sessionId,
        surface: input.surface,
        workspaceContext: input.workspace ? formatWorkspaceContext(input.workspace) ?? undefined : undefined,
      });
      return { ok: true, summary: result || `No output from ${name}.`, tool: name };
    }

    case "list_locations": {
      const locations = await listTravelLocations();
      if (locations.length === 0) {
        return {
          ok: true,
          summary:
            "No whitelisted locations found. Add paths to ~/.ori/config.json or enable auto_discover.",
          tool: name,
        };
      }
      const lines = locations.map(
        (l) => `${l.isGit ? "⎇" : "📁"} ${l.label}  [${l.source}]`,
      );
      return { ok: true, summary: `AVAILABLE LOCATIONS\n\n${lines.join("\n")}`, tool: name };
    }

    case "travel_to": {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) {
        return { ok: false, summary: "travel_to: missing required arg 'query'", tool: name };
      }

      const matches = await fuzzyMatchLocations(query);
      if (matches.length === 0) {
        return {
          ok: false,
          summary: `No whitelisted location matched "${query}". Use list_locations to see available destinations.`,
          tool: name,
        };
      }

      const best = matches[0]!;
      const result = await travelTo(best.absPath);

      if (!result.ok) {
        return { ok: false, summary: `travel_to failed: ${result.error}`, tool: name };
      }

      return {
        ok: true,
        summary: `Traveled to ${result.location!.label} (${result.location!.absPath})`,
        tool: name,
        travel: {
          toPath: result.location!.absPath,
          label: result.location!.label,
          workspace: result.workspace ?? null,
        },
      };
    }

    default:
      return { ok: false, summary: `Unknown tool: ${name}`, tool: name };
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
      packageSummary = [
        `name: ${parsed.name ?? "unknown"}`,
        `type: ${parsed.type ?? "unspecified"}`,
        `scripts: ${Object.keys(parsed.scripts ?? {}).slice(0, 8).join(", ") || "none"}`,
        `dependencies: ${Object.keys(parsed.dependencies ?? {}).slice(0, 8).join(", ") || "none"}`,
        `devDependencies: ${Object.keys(parsed.devDependencies ?? {}).slice(0, 8).join(", ") || "none"}`,
      ].join("\n");
    } catch {
      packageSummary = "package.json: present but unparseable";
    }
  }

  return [
    "WORKSPACE SUMMARY",
    `cwd: ${cwd}`,
    `project: ${path.basename(cwd)}`,
    "",
    "package.json:\n" + packageSummary,
    tsconfig ? "tsconfig.json:\n" + tsconfig.split("\n").slice(0, 24).join("\n") : "tsconfig.json: not found",
    agents ? "AGENTS.md:\n" + agents.split("\n").slice(0, 24).join("\n") : "AGENTS.md: not found",
    recentFiles && recentFiles.length > 0
      ? `recent files: ${recentFiles.slice(0, 12).join(", ")}`
      : "recent files: unavailable",
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
