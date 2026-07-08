export type TrustedMcpCatalogEntry = {
  id: string;
  name: string;
  integration: string;
  aliases: string[];
  description: string;
  installHint: string;
  allowedTools?: string[];
};

export const TRUSTED_MCP_CATALOG: TrustedMcpCatalogEntry[] = [
  {
    id: "playwright",
    name: "Playwright",
    integration: "mcp/playwright",
    aliases: ["browser", "browsing", "web", "web automation", "playwright", "testing", "e2e"],
    description: "Browser automation, page inspection, screenshots, and basic web testing.",
    installHint: "Install/enable a Playwright MCP server in LM Studio and name the server `playwright` in LM Studio's mcp.json.",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    integration: "mcp/filesystem",
    aliases: ["file", "files", "filesystem", "folder", "folders", "directory", "directories", "local files"],
    description: "Scoped file and directory access through an MCP server.",
    installHint: "Install/enable a filesystem MCP server in LM Studio and name the server `filesystem` in LM Studio's mcp.json.",
  },
  {
    id: "github",
    name: "GitHub",
    integration: "mcp/github",
    aliases: ["github", "git hub", "issues", "pull requests", "prs", "repo", "repositories"],
    description: "GitHub repository, issue, and pull-request workflows.",
    installHint: "Install/enable a GitHub MCP server in LM Studio, configure its token there, and name the server `github` in LM Studio's mcp.json.",
  },
  {
    id: "memory",
    name: "Memory",
    integration: "mcp/memory",
    aliases: ["memory", "knowledge graph", "graph memory", "remember", "persistent memory"],
    description: "Simple persistent memory through an MCP server.",
    installHint: "Install/enable a memory MCP server in LM Studio and name the server `memory` in LM Studio's mcp.json.",
  },
  {
    id: "fetch",
    name: "Fetch",
    integration: "mcp/fetch",
    aliases: ["fetch", "http", "url", "urls", "web request", "download", "crawl"],
    description: "HTTP fetch/read access for URLs through an MCP server.",
    installHint: "Install/enable a fetch MCP server in LM Studio and name the server `fetch` in LM Studio's mcp.json.",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    integration: "mcp/sequential-thinking",
    aliases: ["sequential", "sequential thinking", "reasoning", "planning", "planner", "think"],
    description: "Structured step-by-step planning through an MCP server.",
    installHint: "Install/enable a sequential-thinking MCP server in LM Studio and name the server `sequential-thinking` in LM Studio's mcp.json.",
  },
  {
    id: "postgres",
    name: "Postgres",
    integration: "mcp/postgres",
    aliases: ["postgres", "postgresql", "database", "db", "sql"],
    description: "Read/query Postgres databases through an MCP server.",
    installHint: "Install/enable a Postgres MCP server in LM Studio, configure its connection string there, and name the server `postgres` in LM Studio's mcp.json.",
  },
];

export function matchTrustedMcpCatalog(query: string): TrustedMcpCatalogEntry[] {
  const normalized = normalize(query);
  if (!normalized) return [];

  return TRUSTED_MCP_CATALOG.filter((entry) =>
    [entry.id, entry.name, entry.integration, entry.description, ...entry.aliases]
      .some((value) => normalized.includes(normalize(value))),
  );
}

export function describeTrustedMcpCatalog(): string {
  return TRUSTED_MCP_CATALOG
    .map((entry) => `- \`${entry.integration}\` - **${entry.name}**: ${entry.description}`)
    .join("\n");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
