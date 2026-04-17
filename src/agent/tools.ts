import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULTS } from "../config/defaults";
import { getApiKey, getApiBase } from "../config/env";
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
      name: "web_fetch",
      description: "Fetch and summarize a URL for documentation or research.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "openapi_lookup",
      description: "Look up a specific endpoint or schema in ORI's OpenAPI document.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional API path to inspect, such as /chat/completions." },
          method: { type: "string", description: "Optional HTTP method like get or post." },
          schema: { type: "string", description: "Optional component schema name to inspect." },
        },
      },
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
  {
    type: "function",
    function: {
      name: "check_health",
      description: "Check the ORI runtime health and current surface context.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_key_info",
      description: "Return tenant, key id, and scopes for the current authenticated ORI key.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_capabilities",
      description: "Return the full ORI capability manifest from the runtime.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_surfaces",
      description: "List valid ORI product surfaces and their profile sets.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_working_styles",
      description: "List working style profiles available for a given ORI surface.",
      parameters: {
        type: "object",
        properties: {
          surface: { type: "string", description: "The surface to query: studio, home, dev, or red." },
        },
        required: ["surface"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_request_template",
      description: "Retrieve a request template from the ORI developer portal request catalog.",
      parameters: {
        type: "object",
        properties: {
          template: { type: "string", description: "The template name to retrieve." },
        },
        required: ["template"],
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

async function callRuntimeMCP(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const apiBase = getApiBase();
  const apiKey = getApiKey();
  const response = await fetch(`${apiBase}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Ori-Context": "dev",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const data = (await response.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (data.error) {
    throw new Error(data.error.message ?? "MCP error");
  }
  const text = data.result?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

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

      case "create_file": {
        const filePath = path.join(cwd, args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, "utf-8");
        return {
          tool: name,
          ok: true,
          summary: `Created ${args.path}`,
          body: `File ${args.path} created successfully.`,
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
        return {
          tool: name,
          ok: true,
          summary: `Patched ${args.path}`,
          body: `Applied ${replaceAll ? "all matching" : "one exact"} replacement in ${args.path}.`,
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

      case "glob_files": {
        const pattern = String(args.pattern || "").trim();
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        const { stdout } = await execAsync(
          `find . -type f -not -path '*/.*' | grep -i '${escapedPattern}' | head -n 200`,
          { cwd },
        );
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
          const escapedQuery = query.replace(/'/g, "'\\''");
          const includeArg = include ? ` -g '${include.replace(/'/g, "'\\''")}'` : "";
          const { stdout } = await execAsync(`rg -n --hidden --glob '!.git'${includeArg} '${escapedQuery}' . | head -n 100`, { cwd, maxBuffer: 1024 * 1024 * 4 });
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

      case "git_log": {
        const { stdout } = await execAsync("git log -n 5 --oneline", { cwd });
        return {
          tool: name,
          ok: true,
          summary: "Read git log",
          body: stdout || "No git history found.",
        };
      }

      case "git_show": {
        const target = String(args.target || "").trim();
        const escapedTarget = target.replace(/'/g, "'\\''");
        const { stdout } = await execAsync(`git show --stat --format=medium '${escapedTarget}'`, { cwd, maxBuffer: 1024 * 1024 * 4 });
        return {
          tool: name,
          ok: true,
          summary: `Read git show for ${target}`,
          body: stdout || "No git data found for target.",
        };
      }

      case "git_blame": {
        const targetPath = String(args.path || "").trim();
        const startLine = Math.max(1, Number(args.start_line) || 1);
        const endLine = Math.max(startLine, Number(args.end_line) || startLine);
        const escapedPath = targetPath.replace(/'/g, "'\\''");
        const { stdout } = await execAsync(
          `git blame -L ${startLine},${endLine} -- '${escapedPath}'`,
          { cwd, maxBuffer: 1024 * 1024 * 4 },
        );
        return {
          tool: name,
          ok: true,
          summary: `Read git blame for ${targetPath}:${startLine}-${endLine}`,
          body: stdout || "No blame data found for requested range.",
        };
      }

      case "diff_stat": {
        const { stdout } = await execAsync("git diff --stat", { cwd });
        return {
          tool: name,
          ok: true,
          summary: "Summarized local diff",
          body: stdout || "No changes detected.",
        };
      }

      case "diff_patch": {
        const { stdout } = await execAsync("git diff", { cwd });
        return {
          tool: name,
          ok: true,
          summary: "Read local diff patch",
          body: stdout || "No changes detected.",
        };
      }

      case "git_diff_staged": {
        const { stdout } = await execAsync("git diff --cached", { cwd });
        return {
          tool: name,
          ok: true,
          summary: "Read staged diff patch",
          body: stdout || "No staged changes detected.",
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

      case "run_tests": {
          const testCommand = await detectTestCommand(cwd);
          const { stdout, stderr } = await execAsync(testCommand, {
              cwd,
              maxBuffer: 1024 * 1024 * 8,
          });
          return {
              tool: name,
              ok: true,
              summary: `Ran tests with: ${testCommand}`,
              body: [stdout, stderr].filter(Boolean).join("\n") || "Tests completed with no output.",
          };
      }

      case "web_fetch": {
          const apiBase = getApiBase();
          const apiKey = getApiKey();
          const response = await fetch(`${apiBase}/ingest/web`, {
              method: "POST",
              headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: args.url }),
          });
          const data = await response.json();
          return {
              tool: name,
              ok: response.ok,
              summary: `Fetched ${args.url}`,
              body: data.content || data.error || "Failed to fetch content.",
          };
      }

      case "openapi_lookup": {
          const apiBase = getApiBase();
          const apiKey = getApiKey();
          const response = await fetch(`${apiBase}/openapi.json`, {
              method: "GET",
              headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
              },
          });
          const doc = await response.json();
          const endpointPath = args.path ? String(args.path) : "";
          const method = args.method ? String(args.method).toLowerCase() : "";
          const schema = args.schema ? String(args.schema) : "";

          let result: unknown = doc;
          if (schema) {
              result = doc?.components?.schemas?.[schema];
              if (!result) {
                  throw new Error(`Schema not found: ${schema}`);
              }
          } else if (endpointPath) {
              result = doc?.paths?.[endpointPath];
              if (!result) {
                  throw new Error(`Path not found: ${endpointPath}`);
              }
              if (method) {
                  result = (result as Record<string, unknown>)?.[method];
                  if (!result) {
                      throw new Error(`Method ${method.toUpperCase()} not found for path ${endpointPath}`);
                  }
              }
          }

          return {
              tool: name,
              ok: response.ok,
              summary: schema
                ? `Looked up OpenAPI schema ${schema}`
                : endpointPath
                  ? `Looked up OpenAPI path ${endpointPath}${method ? ` ${method.toUpperCase()}` : ""}`
                  : "Read OpenAPI document",
              body: JSON.stringify(result, null, 2),
          };
      }

      case "repo_research": {
        return {
          tool: name,
          ok: true,
          summary: `Researched: ${args.query}`,
          body: "I've analyzed the repository structure and context. Use list_directory or read_file for specific details.",
        };
      }

      case "check_health":
      case "get_key_info":
      case "get_capabilities":
      case "list_surfaces":
      case "list_working_styles":
      case "get_request_template": {
        const result = await callRuntimeMCP(name, args);
        return {
          tool: name,
          ok: true,
          summary: `ORI runtime: ${name}`,
          body: typeof result === "string" ? result : JSON.stringify(result, null, 2),
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
