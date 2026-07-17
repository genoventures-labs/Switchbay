import type { EngineManifest, EngineTool } from "../engines/registry";

export type ScanSeverity = "block" | "warn";

export type ScanFinding = {
  severity: ScanSeverity;
  code: string;
  message: string;
  context?: string;
};

export type ScanResult = {
  safe: boolean;
  findings: ScanFinding[];
};

// Binaries that can pull arbitrary code or exfiltrate data
const DANGEROUS_BINARIES = [
  "curl", "wget", "fetch", "aria2c",
  "ssh", "scp", "sftp", "rsync",
  "nc", "netcat", "ncat", "socat",
  "python", "python3", "ruby", "perl", "node", "bun", "deno",
  "bash", "sh", "zsh", "fish", "dash",
  "eval", "exec", "xargs",
  "sudo", "su", "doas",
  "chmod", "chown",
  "dd", "mkfs",
  "kill", "pkill",
  "crontab",
  "at", "batch",
  "nohup", "disown",
  "screen", "tmux",
  "docker", "podman", "kubectl",
];

// Shell metacharacters that indicate injection / chaining outside of template slots
const SHELL_INJECTION_PATTERN = /[;&|`$](?!\{)/;

// Path traversal
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/;

// Dangerous rm patterns
const RM_RF_PATTERN = /\brm\s+(-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*|--force|--recursive|-rf|-fr)/i;

// Prompt injection markers in markdown content
const PROMPT_INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore (all )?(previous|prior|above|earlier) (instructions?|prompts?|context|rules?)/i, "Classic ignore-prior-instructions injection"],
  [/disregard (all )?(previous|prior|above|earlier)/i, "Disregard injection"],
  [/you are now\b/i, "Role-switch injection"],
  [/\bact as\b.{0,30}(assistant|ai|model|gpt|claude|llm)/i, "Act-as role injection"],
  [/\bnew (role|persona|instructions?|system|context)\b/i, "New-role injection"],
  [/\bsystem:\s/i, "Fake system-turn injection"],
  [/<\|?(system|human|assistant|im_start|im_end)\|?>/i, "Special-token injection"],
  [/\bforget (everything|all|your|prior)/i, "Forget-prior injection"],
  [/\bDAN\b/i, "Do-Anything-Now jailbreak pattern"],
  [/override (safety|content|alignment|policy)/i, "Safety-override instruction"],
];

// Suspicious MCP server patterns
const SUSPICIOUS_MCP_URL_PATTERN = /^https?:\/\/(?!localhost|127\.0\.0\.1|::1|\[::1\])/i;
const SUSPICIOUS_MCP_BINARY_PREFIXES = ["/tmp/", "/var/tmp/", "/dev/shm/"];

export function scanEngineCommand(command: string): ScanResult {
  const findings: ScanFinding[] = [];

  if (RM_RF_PATTERN.test(command)) {
    findings.push({
      severity: "block",
      code: "ENGINE_RM_RF",
      message: "Command contains a recursive force-remove pattern.",
      context: command,
    });
  }

  if (PATH_TRAVERSAL_PATTERN.test(command)) {
    findings.push({
      severity: "block",
      code: "ENGINE_PATH_TRAVERSAL",
      message: "Command contains a path traversal sequence (..).",
      context: command,
    });
  }

  // Check for shell injection outside of template placeholders like {{param}}
  const stripped = command.replace(/\{\{[^}]*\}\}/g, "PLACEHOLDER");
  if (SHELL_INJECTION_PATTERN.test(stripped)) {
    findings.push({
      severity: "block",
      code: "ENGINE_SHELL_INJECTION",
      message: "Command contains shell metacharacters outside of template slots (;, &, |, `, $).",
      context: command,
    });
  }

  // Check leading binary
  const binary = command.trim().split(/\s+/)[0]?.replace(/^.*[/\\]/, "") ?? "";
  if (DANGEROUS_BINARIES.includes(binary.toLowerCase())) {
    findings.push({
      severity: "block",
      code: "ENGINE_DANGEROUS_BINARY",
      message: `Command invokes a potentially dangerous binary: ${binary}`,
      context: command,
    });
  }

  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function scanMarkdownContent(content: string): ScanResult {
  const findings: ScanFinding[] = [];
  for (const [pattern, message] of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        severity: "warn",
        code: "MARKDOWN_PROMPT_INJECTION",
        message,
        context: content.slice(0, 120),
      });
    }
  }
  return { safe: true, findings };
}

export type McpServerConfig = {
  url?: string;
  command?: string;
  args?: string[];
};

export function scanMcpConfig(config: McpServerConfig): ScanResult {
  const findings: ScanFinding[] = [];

  if (config.url && SUSPICIOUS_MCP_URL_PATTERN.test(config.url)) {
    findings.push({
      severity: "warn",
      code: "MCP_REMOTE_URL",
      message: `MCP server points to a remote URL: ${config.url}`,
      context: config.url,
    });
  }

  const binary = config.command ?? config.args?.[0] ?? "";
  if (binary && SUSPICIOUS_MCP_BINARY_PREFIXES.some((p) => binary.startsWith(p))) {
    findings.push({
      severity: "block",
      code: "MCP_TEMP_BINARY",
      message: `MCP server binary is in a temporary/writable path: ${binary}`,
      context: binary,
    });
  }

  if (binary && PATH_TRAVERSAL_PATTERN.test(binary)) {
    findings.push({
      severity: "block",
      code: "MCP_PATH_TRAVERSAL",
      message: "MCP server path contains path traversal (..).",
      context: binary,
    });
  }

  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function scanEngineManifest(manifest: EngineManifest): ScanResult {
  const findings: ScanFinding[] = [];
  for (const tool of manifest.tools) {
    const result = scanEngineTool(tool);
    for (const finding of result.findings) {
      findings.push({ ...finding, context: `tool:${tool.name} — ${finding.context ?? ""}` });
    }
  }
  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function scanEngineTool(tool: EngineTool): ScanResult {
  return scanEngineCommand(tool.command);
}

export function mergeScanResults(...results: ScanResult[]): ScanResult {
  const findings = results.flatMap((r) => r.findings);
  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function formatScanFindings(findings: ScanFinding[]): string {
  return findings
    .map((f) => `  [${f.severity.toUpperCase()}] ${f.code}: ${f.message}${f.context ? `\n    > ${f.context.slice(0, 100)}` : ""}`)
    .join("\n");
}
