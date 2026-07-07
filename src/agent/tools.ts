import path from "node:path";
import fs from "node:fs/promises";
import type { WorkspaceSnapshot } from "../session/workspace";
import type { ShellCommand } from "./turn-state";
import { buildPatchPreview, type PatchPreview } from "../tools/patch";
import { runCommand, runShellString } from "../tools/shell";
import {
  describeEngines,
  loadEngineRegistry,
  parseEngineArgs,
  renderEngineToolCommand,
  shellQuote,
} from "../engines/registry";
import { describeToolbox, readToolboxSkill } from "../toolbox/hub";
import { addMemoryNote, describeMemory, refreshMemory, readMemoryFacts } from "../memory/store";

// Commands that still require approval in the private-tool lane because they
// are destructive, privileged, publishing, or have broad external impact.
const ALWAYS_APPROVE_PATTERN = /\b(rm|rmdir|git\s+push|git\s+reset|git\s+clean|npm\s+publish|bun\s+publish|sudo|chmod|chown|dd|mkfs|fdisk|curl\s.*\|\s*(?:bash|sh)|wget\s.*\|\s*(?:bash|sh))\b/i;

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
};

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file from the local workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_json",
      description: "Read and pretty-print a JSON file from the local workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the JSON file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Read a specific line range from a file in the local workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file." },
          start_line: { type: "number", description: "The 1-based starting line number." },
          end_line: { type: "number", description: "The 1-based ending line number (inclusive)." },
        },
        required: ["path", "start_line", "end_line"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_file",
      description: "Summarize a local workspace file with metadata and its first lines.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file." },
          max_lines: { type: "number", description: "Maximum number of leading lines to include (default: 20)." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List contents of a directory. Use recursive=true for a full crawl.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the directory (defaults to CWD)." },
          recursive: { type: "boolean", description: "Whether to list all nested files recursively." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_files",
      description: "Find files in the workspace by name or glob-like pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "A filename fragment or glob-like pattern to match." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file with the specified content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path for the new file." },
          content: { type: "string", description: "The content to write into the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Overwrite an existing file with new content. Use this for full rewrites. For targeted edits to a specific block, prefer apply_patch instead.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file." },
          content: { type: "string", description: "The full new content to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Apply an exact string replacement to a file. Safer than freeform writes because the target text must already exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file to patch." },
          search: { type: "string", description: "The exact text to find in the file." },
          replace: { type: "string", description: "The replacement text." },
          all_occurrences: { type: "boolean", description: "Whether to replace all matches instead of requiring exactly one." },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a string or regex pattern across all files in the project using ripgrep.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search string or regex." },
          include: { type: "string", description: "Glob pattern for files to include (optional)." },
        },
        required: ["query"],
      },
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
      description: "Show recent commit history for context.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_show",
      description: "Show details for a commit, tag, or file at a git revision.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "A git target such as HEAD, HEAD~1, v0.9.10, or HEAD:path/to/file." },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_blame",
      description: "Show blame information for a specific line range in a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file." },
          start_line: { type: "number", description: "The 1-based starting line number." },
          end_line: { type: "number", description: "The 1-based ending line number (inclusive)." },
        },
        required: ["path", "start_line", "end_line"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_stat",
      description: "Show a summary of current uncommitted changes (git diff --stat).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_patch",
      description: "Show the full patch for current uncommitted changes (git diff).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff_staged",
      description: "Show the full patch for currently staged changes (git diff --cached).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
      type: "function",
      function: {
          name: "verify",
          description: "Run verification commands (e.g. tests or build check) to validate the current workspace state.",
          parameters: { type: "object", properties: {} },
      },
  },
  {
      type: "function",
      function: {
          name: "run_tests",
          description: "Run the most likely repository test command with lightweight auto-detection.",
          parameters: { type: "object", properties: {} },
      },
  },
  {
    type: "function",
    function: {
      name: "shell",
      description: "Run a shell command on the user's local machine. Routine local work runs immediately. Set requires_approval=true only for destructive, privileged, publishing, or external-impact commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          requires_approval: { type: "boolean", description: "True only when the command should be explicitly confirmed before execution." },
          approval_reason: { type: "string", description: "Human-readable description shown to the user when asking for approval." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_add",
      description: "Stage files for commit.",
      parameters: {
        type: "object",
        properties: {
          paths: { type: "string", description: "Space-separated file paths to stage, or '.' to stage all changes." },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description: "Create a git commit with the staged changes. Only use this when the user asked for a commit.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The commit message." },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_push",
      description: "Push commits to the remote repository. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Remote name (default: origin)." },
          branch: { type: "string", description: "Branch name (default: current branch)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_engines",
      description: "List swappable external engines registered with Switchbay.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_engine_tools",
      description: "List tools exposed by a registered Switchbay engine.",
      parameters: {
        type: "object",
        properties: {
          engine_id: { type: "string", description: "Engine id, such as gumops." },
        },
        required: ["engine_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_engine_tool",
      description: "Run a tool exposed by a registered Switchbay engine. Provide args_json as a JSON object string.",
      parameters: {
        type: "object",
        properties: {
          engine_id: { type: "string", description: "Engine id, such as gumops." },
          tool_name: { type: "string", description: "Tool name inside that engine." },
          args_json: { type: "string", description: "Tool arguments as a JSON object string." },
        },
        required: ["engine_id", "tool_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_engines",
      description: "Validate registered Switchbay engine manifests and report warnings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_toolbox_skills",
      description: "List reusable Toolbox skills available to Switchbay agents.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_toolbox_skill",
      description: "Read a Toolbox skill by id.",
      parameters: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "Toolbox skill id, such as code-review-pass." },
        },
        required: ["skill_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_toolbox",
      description: "Pull the GitHub-backed Engine-Toolboxes repo into the local Toolbox cache.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_status",
      description: "Show workspace operational memory status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_refresh",
      description: "Refresh workspace operational memory summary and structured facts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_remember",
      description: "Add a workspace memory note.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "Memory note to save." },
        },
        required: ["note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_facts",
      description: "List structured workspace memory facts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "creative_tools",
      description: "List built-in Creative Engine tools for writing, naming, positioning, hooks, critique, and packets.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "creative_packet",
      description: "Build and save a complete creative packet: brief, positioning, names, hooks, draft copy, and content calendar.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "Project, product, offer, or writing brief." },
          audience: { type: "string", description: "Target audience." },
          format: { type: "string", description: "Primary output format, such as post, email, landing, script, or announcement." },
          days: { type: "number", description: "Content calendar length, up to 31 days." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "creative_brief",
      description: "Turn rough notes into a structured creative brief and save it locally.",
      parameters: {
        type: "object",
        properties: {
          notes: { type: "string", description: "Rough notes, idea, or context." },
        },
        required: ["notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "name_storm",
      description: "Generate naming routes from a brief.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "Naming brief or context." },
          count: { type: "number", description: "Number of name options." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "positioning_routes",
      description: "Explore positioning angles from a brief.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "Project, product, or offer brief." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hook_bank",
      description: "Generate hooks for a topic, audience, and format.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Topic or campaign theme." },
          audience: { type: "string", description: "Target audience." },
          format: { type: "string", description: "Post, email, ad, script, or other format." },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_draft",
      description: "Draft practical copy for a selected format and save it locally.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "Copy brief." },
          format: { type: "string", description: "Post, email, landing, product, bio, or announcement." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "critique_copy",
      description: "Critique copy for clarity, specificity, CTA strength, and cringe risk.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Copy to critique." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "content_calendar",
      description: "Turn a theme into a simple content calendar and save it locally.",
      parameters: {
        type: "object",
        properties: {
          theme: { type: "string", description: "Theme, product, or campaign." },
          days: { type: "number", description: "Number of days, up to 31." },
        },
        required: ["theme"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_tools",
      description: "List the available GumOps tools through the Switchbay engine registry.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_query",
      description: "Ask the GumOps agent a Gumroad operations question through its local CLI.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Question or instruction for the GumOps agent." },
          model: { type: "string", description: "Optional LM Studio model name." },
          no_tools: { type: "boolean", description: "If true, ask GumOps without its own tool-enabled agent actions." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_refresh",
      description: "Refresh GumOps working memory from Gumroad data.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_memory_list",
      description: "List keys in GumOps working memory.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_memory_get",
      description: "Read a GumOps working-memory item by key.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key to read." },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_memory_add",
      description: "Add or update a GumOps working-memory item.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key to add or update." },
          value: { type: "string", description: "Memory value as text or JSON." },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumops_memory_find",
      description: "Search GumOps working memory.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumroad_products",
      description: "List Gumroad products through GumOps.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "number", description: "Gumroad products page to fetch." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gumroad_sales_summary",
      description: "Return Gumroad sales, revenue, and refund summary through GumOps.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gumroad_account_info",
      description: "Return Gumroad seller account info through GumOps.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gumroad_refund_sale",
      description: "Stage a Gumroad refund through GumOps. This always requires explicit approval before execution.",
      parameters: {
        type: "object",
        properties: {
          sale_id: { type: "string", description: "Gumroad sale ID to refund." },
          amount: { type: "number", description: "Optional refund amount. Omit for a full refund." },
          approval_reason: { type: "string", description: "Reason to show before asking the user to approve the refund." },
        },
        required: ["sale_id"],
      },
    },
  },
];

export type AgentToolExecution = {
  tool: string;
  summary: string;
  ok: boolean;
  body: string;
  patch?: PatchPreview;
  changedFile?: string;
  travel?: { toPath: string; label: string; workspace: WorkspaceSnapshot };
  shellPending?: ShellCommand;
};

export async function executeToolCall(
  name: string,
  args: any,
  options: { cwd: string }
): Promise<AgentToolExecution> {
  const cwd = options.cwd;

  try {
    switch (name) {
      case "read_file": {
        const filePath = path.join(cwd, args.path);
        const content = await fs.readFile(filePath, "utf-8");
        return {
          tool: name,
          ok: true,
          summary: `Read ${args.path}`,
          body: content,
        };
      }

      case "read_json": {
        const filePath = path.join(cwd, args.path);
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);
        return {
          tool: name,
          ok: true,
          summary: `Read JSON ${args.path}`,
          body: JSON.stringify(parsed, null, 2),
        };
      }

      case "read_file_range": {
        const filePath = path.join(cwd, args.path);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const startLine = Math.max(1, Number(args.start_line) || 1);
        const endLine = Math.max(startLine, Number(args.end_line) || startLine);
        const selected = lines
          .slice(startLine - 1, endLine)
          .map((line, index) => `${startLine + index}: ${line}`)
          .join("\n");

        return {
          tool: name,
          ok: true,
          summary: `Read ${args.path}:${startLine}-${endLine}`,
          body: selected || "No content in requested range.",
        };
      }

      case "summarize_file": {
        const targetPath = String(args.path || "").trim();
        if (!targetPath) throw new Error("summarize_file requires a path.");
        const filePath = path.join(cwd, targetPath);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          throw new Error(`Path is not a file: ${targetPath}`);
        }

        const maxLines = Math.max(1, Math.min(200, Number(args.max_lines) || 20));
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const preview = lines
          .slice(0, maxLines)
          .map((line, index) => `${index + 1}: ${line}`)
          .join("\n");

        return {
          tool: name,
          ok: true,
          summary: `Summarized ${targetPath}`,
          body: [
            `Path: ${targetPath}`,
            `Size: ${stat.size} bytes`,
            `Total lines: ${lines.length}`,
            `Preview lines: 1-${Math.min(maxLines, lines.length)}`,
            "",
            preview || "No content.",
          ].join("\n"),
        };
      }

      case "create_file": {
        const filePath = path.join(cwd, args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, "utf-8");
        const lines = String(args.content).split("\n");
        const preview = lines.slice(0, 6).map((l, i) => `+ ${i + 1}: ${l}`).join("\n")
          + (lines.length > 6 ? `\n  … (+${lines.length - 6} more lines)` : "");
        return {
          tool: name,
          ok: true,
          summary: `Created ${args.path}`,
          body: `Created ${args.path} (${lines.length} lines)\n\n${preview}`,
          changedFile: args.path,
        };
      }

      case "write_file": {
        const filePath = path.join(cwd, args.path);
        let before = "";
        try { before = await fs.readFile(filePath, "utf-8"); } catch { /* new file */ }
        const after = String(args.content);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, after, "utf-8");
        const beforeLines = before.split("\n");
        const afterLines = after.split("\n");
        const preview = [
          `- ${beforeLines.length} lines before`,
          `+ ${afterLines.length} lines after`,
          ...afterLines.slice(0, 5).map(l => `+ ${l}`),
          ...(afterLines.length > 5 ? [`  … (+${afterLines.length - 5} more)`] : []),
        ].join("\n");
        return {
          tool: name,
          ok: true,
          summary: `Wrote ${args.path}`,
          body: `Rewrote ${args.path}\n\n${preview}`,
          changedFile: args.path,
          patch: await buildPatchPreview({ before, after, cwd, targetPath: args.path }),
        };
      }

      case "apply_patch": {
        const filePath = path.join(cwd, args.path);
        const content = await fs.readFile(filePath, "utf-8");
        const search = String(args.search ?? "");
        const replace = String(args.replace ?? "");
        const replaceAll = Boolean(args.all_occurrences);

        if (!search) {
          throw new Error("apply_patch requires non-empty search text.");
        }

        const matches = content.split(search).length - 1;
        if (matches === 0) {
          throw new Error("Search text not found in file.");
        }
        if (!replaceAll && matches !== 1) {
          throw new Error(`Search text matched ${matches} times. Set all_occurrences=true or provide a more specific search block.`);
        }

        const updated = replaceAll
          ? content.split(search).join(replace)
          : content.replace(search, replace);

        await fs.writeFile(filePath, updated, "utf-8");

        // Show a compact before/after snippet (up to 4 lines each side)
        const beforeLines = search.split("\n").slice(0, 4);
        const afterLines = replace.split("\n").slice(0, 4);
        const diffPreview = [
          ...beforeLines.map(l => `- ${l}`),
          ...(search.split("\n").length > 4 ? [`  … (${search.split("\n").length - 4} more)`] : []),
          ...afterLines.map(l => `+ ${l}`),
          ...(replace.split("\n").length > 4 ? [`  … (${replace.split("\n").length - 4} more)`] : []),
        ].join("\n");

        return {
          tool: name,
          ok: true,
          summary: `Patched ${args.path}`,
          body: `Patched ${args.path}\n\n${diffPreview}`,
          changedFile: args.path,
          patch: await buildPatchPreview({ before: content, after: updated, cwd, targetPath: args.path }),
        };
      }

      case "list_directory": {
        const targetPath = path.join(cwd, args.path || ".");
        const recursive = !!args.recursive;
        
        let output = "";
        if (recursive) {
           const result = await runCommand(["find", ".", "-maxdepth", "4", "-not", "-path", "*/.*"], targetPath);
           if (!result.ok) throw new Error(result.stderr || result.stdout || "find failed");
           output = result.stdout;
        } else {
           const entries = await fs.readdir(targetPath, { withFileTypes: true });
           output = entries.map(e => `${e.name}${e.isDirectory() ? "/" : ""}`).join("\n");
        }
        
        return {
          tool: name,
          ok: true,
          summary: `Listed ${args.path || "CWD"}${recursive ? " recursively" : ""}`,
          body: output,
        };
      }

      case "glob_files": {
        const pattern = String(args.pattern || "").trim();
        const result = await runCommand(["find", ".", "-type", "f", "-not", "-path", "*/.*"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "find failed");
        const stdout = result.stdout
          .split("\n")
          .filter((file) => file.toLowerCase().includes(pattern.toLowerCase()))
          .slice(0, 200)
          .join("\n");
        return {
          tool: name,
          ok: true,
          summary: `Matched files for "${pattern}"`,
          body: stdout || "No matching files found.",
        };
      }

      case "search_files": {
          const query = String(args.query || "").trim();
          const include = String(args.include || "").trim();
          const result = await runCommand(
            ["rg", "-n", "--hidden", "--glob", "!.git", ...(include ? ["-g", include] : []), query, "."],
            cwd,
          );
          const stdout = result.stdout.split("\n").slice(0, 100).join("\n");
          return {
              tool: name,
              ok: true,
              summary: `Searched for "${query}"`,
              body: stdout || "No matches found.",
          };
      }

      case "git_status": {
        const result = await runCommand(["git", "status", "--short"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git status failed");
        return {
          tool: name,
          ok: true,
          summary: "Checked git status",
          body: result.stdout || "Working tree clean.",
        };
      }

      case "git_log": {
        const result = await runCommand(["git", "log", "-n", "5", "--oneline"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git log failed");
        return {
          tool: name,
          ok: true,
          summary: "Read git log",
          body: result.stdout || "No git history found.",
        };
      }

      case "git_show": {
        const target = String(args.target || "").trim();
        const result = await runCommand(["git", "show", "--stat", "--format=medium", target], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git show failed");
        return {
          tool: name,
          ok: true,
          summary: `Read git show for ${target}`,
          body: result.stdout || "No git data found for target.",
        };
      }

      case "git_blame": {
        const targetPath = String(args.path || "").trim();
        const startLine = Math.max(1, Number(args.start_line) || 1);
        const endLine = Math.max(startLine, Number(args.end_line) || startLine);
        const result = await runCommand(["git", "blame", "-L", `${startLine},${endLine}`, "--", targetPath], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git blame failed");
        return {
          tool: name,
          ok: true,
          summary: `Read git blame for ${targetPath}:${startLine}-${endLine}`,
          body: result.stdout || "No blame data found for requested range.",
        };
      }

      case "diff_stat": {
        const result = await runCommand(["git", "diff", "--stat"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git diff failed");
        return {
          tool: name,
          ok: true,
          summary: "Summarized local diff",
          body: result.stdout || "No changes detected.",
        };
      }

      case "diff_patch": {
        const result = await runCommand(["git", "diff"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git diff failed");
        return {
          tool: name,
          ok: true,
          summary: "Read local diff patch",
          body: result.stdout || "No changes detected.",
        };
      }

      case "git_diff_staged": {
        const result = await runCommand(["git", "diff", "--cached"], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git diff --cached failed");
        return {
          tool: name,
          ok: true,
          summary: "Read staged diff patch",
          body: result.stdout || "No staged changes detected.",
        };
      }

      case "verify": {
          const buildCmd = await (async () => {
            try {
              const pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf-8")) as { scripts?: Record<string, string> };
              if (pkg.scripts?.build) return "bun run build";
            } catch { /* no package.json */ }
            try { await fs.access(path.join(cwd, "go.mod")); return "go build ./..."; } catch { /* not go */ }
            try { await fs.access(path.join(cwd, "Cargo.toml")); return "cargo build"; } catch { /* not rust */ }
            return null;
          })();

          if (!buildCmd) {
            return { tool: name, ok: true, summary: "No build command detected", body: "No build system detected in this workspace." };
          }

          try {
            const result = await runShellString(buildCmd, cwd);
            if (!result.ok) throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
            const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
            return { tool: name, ok: true, summary: `Build passed: ${buildCmd}`, body: output || "Build succeeded with no output." };
          } catch (err: any) {
            const output = String(err.message || err).trim();
            return { tool: name, ok: false, summary: `Build FAILED: ${buildCmd}`, body: `Build failed:\n\n${output}` };
          }
      }

      case "run_tests": {
          const testCommand = await detectTestCommand(cwd);
          try {
            const result = await runShellString(testCommand, cwd);
            if (!result.ok) throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
            const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
            return { tool: name, ok: true, summary: `Tests passed: ${testCommand}`, body: output || "Tests passed with no output." };
          } catch (err: any) {
            const output = String(err.message || err).trim();
            return { tool: name, ok: false, summary: `Tests FAILED: ${testCommand}`, body: `Tests failed:\n\n${output}` };
          }
      }

      case "shell": {
        const command = String(args.command || "").trim();
        if (!command) throw new Error("shell requires a command.");
        const approvalReason = String(args.approval_reason || command);
        const requiresApproval = args.requires_approval === true || ALWAYS_APPROVE_PATTERN.test(command);
        if (requiresApproval) {
          return {
            tool: name,
            ok: true,
            summary: `Shell pending: ${command.slice(0, 50)}`,
            body: `Awaiting approval to run:\n\`${command}\`\n\n${approvalReason}`,
            shellPending: { command, reason: approvalReason },
          };
        }
        const result = await runShellString(command, cwd);
        if (!result.ok) {
          throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
        }
        return {
          tool: name,
          ok: true,
          summary: `Ran: ${command.split(/\s+/)[0]}`,
          body: [result.stdout, result.stderr].filter(Boolean).join("\n") || "Done.",
        };
      }

      case "git_add": {
        const paths = String(args.paths || ".").trim();
        const result = await runCommand(["git", "add", ...paths.split(/\s+/).filter(Boolean)], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git add failed");
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        return {
          tool: name,
          ok: true,
          summary: `git add ${paths}`,
          body: output || `Staged ${paths === "." ? "all changes" : paths}.`,
        };
      }

      case "git_commit": {
        const message = String(args.message || "").trim();
        if (!message) throw new Error("git_commit requires a message.");
        const result = await runCommand(["git", "commit", "-m", message], cwd);
        if (!result.ok) throw new Error(result.stderr || result.stdout || "git commit failed");
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        return {
          tool: name,
          ok: true,
          summary: `git commit: ${message.slice(0, 40)}`,
          body: output || `Created commit: ${message}`,
        };
      }

      case "git_push": {
        const remote = String(args.remote || "origin").trim();
        const branch = String(args.branch || "").trim();
        const command = branch ? `git push ${remote} ${branch}` : `git push ${remote}`;
        return {
          tool: name,
          ok: true,
          summary: `git push ${remote}`,
          body: `Awaiting approval to run:\n\`${command}\``,
          shellPending: { command, reason: `Push commits to ${remote}${branch ? `/${branch}` : ""}.` },
        };
      }

      case "list_engines": {
        return {
          tool: name,
          ok: true,
          summary: "Listed Switchbay engines",
          body: await describeEngines(cwd),
        };
      }

      case "list_engine_tools": {
        const engineId = String(args.engine_id || "").trim();
        if (!engineId) throw new Error("list_engine_tools requires an engine_id.");
        const registry = await loadEngineRegistry(cwd);
        const engine = registry.engines.find((entry) => entry.id === engineId);
        if (!engine) throw new Error(`Engine not found: ${engineId}`);
        const body = engine.tools
          .map((tool) => {
            const params = Object.entries(tool.parameters ?? {})
              .map(([param, config]) => `${param}:${config.type}`)
              .join(", ");
            return `${tool.name}${params ? ` (${params})` : ""} - ${tool.description}`;
          })
          .join("\n");
        return {
          tool: name,
          ok: true,
          summary: `Listed tools for ${engineId}`,
          body: body || `Engine ${engineId} has no tools.`,
        };
      }

      case "validate_engines": {
        const registry = await loadEngineRegistry(cwd);
        return {
          tool: name,
          ok: registry.warnings.length === 0,
          summary: registry.warnings.length === 0 ? "Engine registry is valid" : "Engine registry has warnings",
          body: registry.warnings.length === 0
            ? `Loaded ${registry.engines.length} engine(s): ${registry.engines.map((engine) => engine.id).join(", ") || "(none)"}`
            : registry.warnings.join("\n"),
        };
      }

      case "list_toolbox_skills": {
        return {
          tool: name,
          ok: true,
          summary: "Listed Toolbox skills",
          body: await describeToolbox(false),
        };
      }

      case "read_toolbox_skill": {
        const skillId = String(args.skill_id || "").trim();
        if (!skillId) throw new Error("read_toolbox_skill requires a skill_id.");
        const skill = await readToolboxSkill(skillId);
        return {
          tool: name,
          ok: Boolean(skill),
          summary: skill ? `Read Toolbox skill ${skill.id}` : `Toolbox skill not found: ${skillId}`,
          body: skill?.body ?? `Toolbox skill not found: ${skillId}`,
        };
      }

      case "sync_toolbox": {
        return {
          tool: name,
          ok: true,
          summary: "Synced Toolbox",
          body: await describeToolbox(true),
        };
      }

      case "memory_status": {
        return {
          tool: name,
          ok: true,
          summary: "Read operational memory status",
          body: await describeMemory(cwd),
        };
      }

      case "memory_refresh": {
        return {
          tool: name,
          ok: true,
          summary: "Refreshed operational memory",
          body: await refreshMemory(cwd),
        };
      }

      case "memory_remember": {
        const note = String(args.note || "").trim();
        if (!note) throw new Error("memory_remember requires a note.");
        const count = await addMemoryNote(cwd, note);
        return {
          tool: name,
          ok: true,
          summary: "Saved memory note",
          body: `Remembered: ${note}\n\n${count} note${count !== 1 ? "s" : ""} in memory.`,
        };
      }

      case "memory_facts": {
        const facts = await readMemoryFacts(cwd);
        return {
          tool: name,
          ok: true,
          summary: "Read memory facts",
          body: facts.length ? facts.map((fact) => `${fact.key}: ${fact.value}`).join("\n") : "No memory facts. Run memory_refresh first.",
        };
      }

      case "run_engine_tool": {
        const engineId = String(args.engine_id || "").trim();
        const toolName = String(args.tool_name || "").trim();
        if (!engineId) throw new Error("run_engine_tool requires an engine_id.");
        if (!toolName) throw new Error("run_engine_tool requires a tool_name.");
        return executeEngineTool(name, engineId, toolName, parseEngineArgs(args.args_json), cwd);
      }

      case "creative_tools": {
        return executeEngineTool(name, "creative", "list_voices", {}, cwd)
          .then(async (voices) => {
            const registry = await loadEngineRegistry(cwd);
            const creative = registry.engines.find((entry) => entry.id === "creative");
            const tools = creative?.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") ?? "No creative tools found.";
            return {
              ...voices,
              summary: "Listed Creative Engine tools",
              body: `${tools}\n\nVoices:\n${voices.body}`,
            };
          });
      }

      case "creative_packet": {
        const brief = String(args.brief || "").trim();
        if (!brief) throw new Error("creative_packet requires a brief.");
        return executeEngineTool(name, "creative", "creative_packet", {
          brief,
          audience: stringOrDefault(args.audience, "the target audience"),
          format: stringOrDefault(args.format, "post"),
          days: positiveNumberOrDefault(args.days, 7),
        }, cwd);
      }

      case "creative_brief": {
        const notes = String(args.notes || "").trim();
        if (!notes) throw new Error("creative_brief requires notes.");
        return executeEngineTool(name, "creative", "creative_brief", { notes }, cwd);
      }

      case "name_storm": {
        const brief = String(args.brief || "").trim();
        if (!brief) throw new Error("name_storm requires a brief.");
        return executeEngineTool(name, "creative", "name_storm", { brief, count: positiveNumberOrDefault(args.count, 12) }, cwd);
      }

      case "positioning_routes": {
        const brief = String(args.brief || "").trim();
        if (!brief) throw new Error("positioning_routes requires a brief.");
        return executeEngineTool(name, "creative", "positioning_routes", { brief }, cwd);
      }

      case "hook_bank": {
        const topic = String(args.topic || "").trim();
        if (!topic) throw new Error("hook_bank requires a topic.");
        return executeEngineTool(name, "creative", "hook_bank", {
          topic,
          audience: stringOrDefault(args.audience, "the target audience"),
          format: stringOrDefault(args.format, "post"),
        }, cwd);
      }

      case "copy_draft": {
        const brief = String(args.brief || "").trim();
        if (!brief) throw new Error("copy_draft requires a brief.");
        return executeEngineTool(name, "creative", "copy_draft", {
          brief,
          format: stringOrDefault(args.format, "post"),
        }, cwd);
      }

      case "critique_copy": {
        const text = String(args.text || "").trim();
        if (!text) throw new Error("critique_copy requires text.");
        return executeEngineTool(name, "creative", "critique_copy", { text }, cwd);
      }

      case "content_calendar": {
        const theme = String(args.theme || "").trim();
        if (!theme) throw new Error("content_calendar requires a theme.");
        return executeEngineTool(name, "creative", "content_calendar", { theme, days: positiveNumberOrDefault(args.days, 7) }, cwd);
      }

      case "gumops_tools": {
        return executeEngineTool(name, "gumops", "tools", {}, cwd);
      }

      case "gumops_query": {
        const query = String(args.query || "").trim();
        if (!query) throw new Error("gumops_query requires a query.");
        return executeEngineTool(name, "gumops", args.no_tools === true ? "query_no_tools" : "query", { query }, cwd);
      }

      case "gumops_refresh": {
        return executeEngineTool(name, "gumops", "refresh", {}, cwd);
      }

      case "gumops_memory_list": {
        return executeEngineTool(name, "gumops", "memory_list", {}, cwd);
      }

      case "gumops_memory_get": {
        const key = String(args.key || "").trim();
        if (!key) throw new Error("gumops_memory_get requires a key.");
        return executeEngineTool(name, "gumops", "memory_get", { key }, cwd);
      }

      case "gumops_memory_add": {
        const key = String(args.key || "").trim();
        const value = String(args.value || "").trim();
        if (!key) throw new Error("gumops_memory_add requires a key.");
        if (!value) throw new Error("gumops_memory_add requires a value.");
        return executeEngineTool(name, "gumops", "memory_add", { key, value }, cwd);
      }

      case "gumops_memory_find": {
        const query = String(args.query || "").trim();
        if (!query) throw new Error("gumops_memory_find requires a query.");
        return executeEngineTool(name, "gumops", "memory_find", { query }, cwd);
      }

      case "gumroad_products": {
        const page = Math.max(1, Number(args.page) || 1);
        return executeEngineTool(name, "gumops", "products", { page }, cwd);
      }

      case "gumroad_sales_summary": {
        return executeEngineTool(name, "gumops", "sales_summary", {}, cwd);
      }

      case "gumroad_account_info": {
        return executeEngineTool(name, "gumops", "account_info", {}, cwd);
      }

      case "gumroad_refund_sale": {
        const saleId = String(args.sale_id || "").trim();
        if (!saleId) throw new Error("gumroad_refund_sale requires a sale_id.");
        const amount = args.amount === undefined || args.amount === null || args.amount === ""
          ? null
          : Number(args.amount);
        if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
          throw new Error("gumroad_refund_sale amount must be a positive number when provided.");
        }
        return executeEngineTool(name, "gumops", "refund_sale", { sale_id: saleId, amount }, cwd);
      }

      default:
        return {
          tool: name,
          ok: false,
          summary: `Unknown tool: ${name}`,
          body: `Tool ${name} is not implemented in this surface.`,
        };
    }
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : String(err);
    const firstLine = reason.split("\n").find((line) => line.trim().length > 0)?.trim();
    return {
      tool: name,
      ok: false,
      summary: `${name} failed${firstLine ? `: ${firstLine}` : ""}`,
      body: reason,
    };
  }
}

async function detectTestCommand(cwd: string): Promise<string> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    if (scripts.test) {
      return "bun test || npm test";
    }
  } catch {
    // ignore missing or invalid package.json
  }

  try {
    await fs.access(path.join(cwd, "bun.lock"));
    return "bun test";
  } catch {
    // no bun lock
  }

  try {
    await fs.access(path.join(cwd, "go.mod"));
    return "go test ./...";
  } catch {
    // no go.mod
  }

  return "bun run build || npm run build || true";
}

async function executeEngineTool(
  tool: string,
  engineId: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<AgentToolExecution> {
  const rendered = await renderEngineToolCommand(engineId, toolName, args, cwd);
  if (rendered.requiresApproval || ALWAYS_APPROVE_PATTERN.test(rendered.command)) {
    const reason = rendered.approvalReason;
    return {
      tool,
      ok: true,
      summary: `Engine pending: ${rendered.engine.id}.${rendered.tool.name}`,
      body: `Awaiting approval to run engine tool:\n\`${rendered.command}\`\n\n${reason}`,
      shellPending: {
        command: `cd ${shellQuote(rendered.cwd)} && ${rendered.command}`,
        reason,
      },
    };
  }

  const result = await runShellString(rendered.command, rendered.cwd);
  return engineResult(
    tool,
    result.ok ? `Ran ${rendered.engine.id}.${rendered.tool.name}` : `${rendered.engine.id}.${rendered.tool.name} failed`,
    result,
  );
}

function engineResult(tool: string, summary: string, result: Awaited<ReturnType<typeof runCommand>>): AgentToolExecution {
  const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    tool,
    ok: result.ok,
    summary,
    body: body || (result.ok ? "Done." : `Command exited with ${result.exitCode}.`),
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
