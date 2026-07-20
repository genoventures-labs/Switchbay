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

// Shells — block when invoked bare or with -c (arbitrary code execution)
const SHELL_BINARIES = new Set(["bash", "sh", "zsh", "fish", "dash", "csh", "ksh", "tcsh"]);

// Scripting languages — acceptable when running a fixed local script file; block with eval flags
const SCRIPTING_LANGUAGES = new Set(["python", "python3", "ruby", "perl", "node", "bun", "deno"]);
const SCRIPTING_EVAL_FLAGS = new Set(["-c", "-e", "--eval", "--code", "-"]);

// Network tools — can pull arbitrary code or exfiltrate data
const NETWORK_BINARIES = new Set(["curl", "wget", "aria2c", "fetch", "nc", "netcat", "ncat", "socat", "rsync", "scp", "sftp", "ssh"]);

// Privilege escalation
const PRIVILEGE_BINARIES = new Set(["sudo", "su", "doas"]);

// Destructive / system modification
const DESTRUCTIVE_BINARIES = new Set([
  "chmod", "chown", "dd", "mkfs", "kill", "pkill",
  "crontab", "at", "batch", "nohup", "disown",
  "screen", "tmux",
]);

// Container / orchestration tools
const CONTAINER_BINARIES = new Set(["docker", "podman", "kubectl"]);

// Misc dangerous builtins
const MISC_DANGEROUS = new Set(["eval", "exec", "xargs"]);

// Shell metacharacters that indicate injection / chaining outside of template slots
const SHELL_INJECTION_PATTERN = /[;&|`$](?!\{)/;

// Path traversal
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/;

// Dangerous rm patterns
const RM_RF_PATTERN = /\brm\s+(-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*|--force|--recursive|-rf|-fr)/i;

// Prompt injection markers in skill / metadata content
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

function getCommandTokens(command: string): string[] {
  return command.replace(/\{\{[^}]*\}\}/g, "").trim().split(/\s+/).filter(Boolean);
}

function isScriptingLangWithFixedScript(tokens: string[]): boolean {
  // tokens[0] is the binary; look for a fixed script file (not an eval flag)
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (SCRIPTING_EVAL_FLAGS.has(token)) return false;
    if (/\.(py|rb|pl|js|ts|mjs|mts|cjs|r)$/i.test(token) && !token.startsWith("-")) return true;
  }
  return false;
}

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

  // Shell injection outside of template placeholders
  const stripped = command.replace(/\{\{[^}]*\}\}/g, "PLACEHOLDER");
  if (SHELL_INJECTION_PATTERN.test(stripped)) {
    findings.push({
      severity: "block",
      code: "ENGINE_SHELL_INJECTION",
      message: "Command contains shell metacharacters outside of template slots (;, &, |, `, $).",
      context: command,
    });
  }

  const tokens = getCommandTokens(command);
  const binary = (tokens[0] ?? "").replace(/^.*[/\\]/, "").toLowerCase();

  if (NETWORK_BINARIES.has(binary)) {
    findings.push({
      severity: "block",
      code: "ENGINE_NETWORK_TOOL",
      message: `Command invokes a network tool that can pull or exfiltrate data: ${tokens[0]}`,
      context: command,
    });
  } else if (PRIVILEGE_BINARIES.has(binary)) {
    findings.push({
      severity: "block",
      code: "ENGINE_PRIVILEGE_ESCALATION",
      message: `Command uses privilege escalation: ${tokens[0]}`,
      context: command,
    });
  } else if (DESTRUCTIVE_BINARIES.has(binary)) {
    findings.push({
      severity: "block",
      code: "ENGINE_DESTRUCTIVE_BINARY",
      message: `Command invokes a destructive or system-modifying binary: ${tokens[0]}`,
      context: command,
    });
  } else if (CONTAINER_BINARIES.has(binary)) {
    findings.push({
      severity: "block",
      code: "ENGINE_CONTAINER_BINARY",
      message: `Command invokes a container/orchestration tool: ${tokens[0]}`,
      context: command,
    });
  } else if (MISC_DANGEROUS.has(binary)) {
    findings.push({
      severity: "block",
      code: "ENGINE_DANGEROUS_BINARY",
      message: `Command invokes a dangerous built-in: ${tokens[0]}`,
      context: command,
    });
  } else if (SHELL_BINARIES.has(binary)) {
    // Shell binaries with -c flag or no script argument are dangerous (arbitrary code execution)
    const hasEvalFlag = tokens.slice(1).some((t) => t === "-c" || t === "--");
    const hasFixedScript = tokens.slice(1).some((t) => /\.(sh|bash|zsh|ksh|fish)$/i.test(t) && !t.startsWith("-"));
    if (hasEvalFlag || !hasFixedScript) {
      findings.push({
        severity: "block",
        code: "ENGINE_SHELL_BINARY",
        message: `Command uses a shell interpreter (${tokens[0]}) without a fixed script file — potential arbitrary code execution.`,
        context: command,
      });
    } else {
      findings.push({
        severity: "warn",
        code: "ENGINE_SHELL_SCRIPT",
        message: `Command runs a shell script via ${tokens[0]} — verify the script is trusted.`,
        context: command,
      });
    }
  } else if (SCRIPTING_LANGUAGES.has(binary)) {
    // Scripting languages with eval flags are dangerous; running a fixed script is fine
    const hasEvalFlag = tokens.slice(1).some((t) => SCRIPTING_EVAL_FLAGS.has(t));
    if (hasEvalFlag) {
      findings.push({
        severity: "block",
        code: "ENGINE_SCRIPTING_EVAL",
        message: `Command passes code directly to ${tokens[0]} via an eval flag (-c / -e / --eval) — potential arbitrary code execution.`,
        context: command,
      });
    } else if (!isScriptingLangWithFixedScript(tokens)) {
      findings.push({
        severity: "warn",
        code: "ENGINE_SCRIPTING_NO_SCRIPT",
        message: `Command invokes ${tokens[0]} without a clear fixed script file — verify the command is intentional.`,
        context: command,
      });
    }
    // Fixed script + user template args → no finding (legitimate use)
  }

  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function scanEngineMetadata(manifest: EngineManifest): ScanResult {
  const findings: ScanFinding[] = [];
  const toCheck = [
    manifest.name ?? "",
    (manifest as Record<string, unknown>).description as string ?? "",
    ...manifest.tools.map((t) => t.name ?? ""),
    ...manifest.tools.map((t) => (t as Record<string, unknown>).description as string ?? ""),
  ].join("\n");

  for (const [pattern, message] of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(toCheck)) {
      findings.push({
        severity: "block",
        code: "ENGINE_METADATA_INJECTION",
        message: `Prompt injection in engine metadata: ${message}`,
        context: toCheck.slice(0, 100),
      });
    }
  }
  return { safe: findings.every((f) => f.severity !== "block"), findings };
}

export function scanMarkdownContent(content: string): ScanResult {
  const findings: ScanFinding[] = [];
  for (const [pattern, message] of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        severity: "block",
        code: "SKILL_PROMPT_INJECTION",
        message,
        context: content.slice(0, 120),
      });
    }
  }
  return { safe: findings.every((f) => f.severity !== "block"), findings };
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
  const results: ScanResult[] = [scanEngineMetadata(manifest)];
  for (const tool of manifest.tools) {
    const result = scanEngineTool(tool);
    results.push({
      safe: result.safe,
      findings: result.findings.map((f) => ({ ...f, context: `tool:${tool.name} — ${f.context ?? ""}` })),
    });
  }
  return mergeScanResults(...results);
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
