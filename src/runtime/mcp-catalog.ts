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
    installHint: "Install a Playwright MCP server and add `mcp/playwright` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    integration: "mcp/filesystem",
    aliases: ["file", "files", "filesystem", "folder", "folders", "directory", "directories", "local files"],
    description: "Scoped file and directory access through an MCP server.",
    installHint: "Install a filesystem MCP server and add `mcp/filesystem` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "github",
    name: "GitHub",
    integration: "mcp/github",
    aliases: ["github", "git hub", "issues", "pull requests", "prs", "repo", "repositories"],
    description: "GitHub repository, issue, and pull-request workflows.",
    installHint: "Install a GitHub MCP server, configure its token, and add `mcp/github` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "memory",
    name: "Memory",
    integration: "mcp/memory",
    aliases: ["memory", "knowledge graph", "graph memory", "remember", "persistent memory"],
    description: "Simple persistent memory through an MCP server.",
    installHint: "Install a memory MCP server and add `mcp/memory` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "fetch",
    name: "Fetch",
    integration: "mcp/fetch",
    aliases: ["fetch", "http", "url", "urls", "web request", "download", "crawl"],
    description: "HTTP fetch/read access for URLs through an MCP server.",
    installHint: "Install a fetch MCP server and add `mcp/fetch` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    integration: "mcp/sequential-thinking",
    aliases: ["sequential", "sequential thinking", "reasoning", "planning", "planner", "think"],
    description: "Structured step-by-step planning through an MCP server.",
    installHint: "Install a sequential-thinking MCP server and add `mcp/sequential-thinking` to your `~/.switchbay/mcp.json` integrations.",
  },
  {
    id: "postgres",
    name: "Postgres",
    integration: "mcp/postgres",
    aliases: ["postgres", "postgresql", "database", "db", "sql"],
    description: "Read/query Postgres databases through an MCP server.",
    installHint: "Install a Postgres MCP server, configure its connection string, and add `mcp/postgres` to your `~/.switchbay/mcp.json` integrations.",
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
