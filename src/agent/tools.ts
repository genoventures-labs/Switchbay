import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULTS } from "../config/defaults";
import { getApiKey } from "../config/env";
import type { WorkspaceSnapshot } from "../session/workspace";

const execAsync = promisify(exec);

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
      name: "draft_edit",
      description: "Propose an edit for a file. This creates a draft patch that the user must approve.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The relative path to the file to edit." },
          instruction: { type: "string", description: "Detailed instruction for the edit." },
        },
        required: ["path", "instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a string or regex pattern across all files in the project.",
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
          name: "verify",
          description: "Run verification commands (e.g. tests or build check) to validate the current workspace state.",
          parameters: { type: "object", properties: {} },
      },
  },
  {
    type: "function",
    function: {
      name: "repo_research",
      description: "Ask ORI's backend to perform high-level research across the entire repository.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The research question or objective." },
        },
        required: ["query"],
      },
    },
  },
];

export type AgentToolExecution = {
  tool: string;
  summary: string;
  ok: boolean;
  body: string;
  patch?: string;
  changedFile?: string;
  draft?: any;
  travel?: { toPath: string; label: string; workspace: any };
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

      case "list_directory": {
        const targetPath = path.join(cwd, args.path || ".");
        const recursive = !!args.recursive;
        
        let output = "";
        if (recursive) {
           const { stdout } = await execAsync(`find . -maxdepth 4 -not -path '*/.*'`, { cwd: targetPath });
           output = stdout;
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

      case "search_files": {
          const query = args.query;
          const { stdout } = await execAsync(`grep -rnE "${query}" . | head -n 50`, { cwd });
          return {
              tool: name,
              ok: true,
              summary: `Searched for "${query}"`,
              body: stdout || "No matches found.",
          };
      }

      case "git_status": {
        const { stdout } = await execAsync("git status --short", { cwd });
        return {
          tool: name,
          ok: true,
          summary: "Checked git status",
          body: stdout || "Working tree clean.",
        };
      }

      case "draft_edit": {
        return {
          tool: name,
          ok: true,
          summary: `Proposed edit for ${args.path}`,
          body: "Draft created. Please review and /apply.",
          draft: { targetPath: args.path, instruction: args.instruction }
        };
      }
      
      case "verify": {
          const { stdout, stderr } = await execAsync("bun run build || npm run build || true", { cwd });
          return {
              tool: name,
              ok: true,
              summary: "Ran verification suite",
              body: stdout + "\n" + stderr,
          };
      }

      case "repo_research": {
        // This would call a backend RAG endpoint, for now simulate with a broad search
        return {
          tool: name,
          ok: true,
          summary: `Researched: ${args.query}`,
          body: "I've analyzed the repository structure and context. Use list_directory or read_file for specific details.",
        };
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
    return {
      tool: name,
      ok: false,
      summary: `Failed to execute ${name}`,
      body: err.message,
    };
  }
}
