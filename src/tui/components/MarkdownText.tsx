import React from "react";
import { Box, Text } from "ink";

type MarkdownTextProps = {
  content: string;
  role?: "assistant" | "tool" | "user";
};

type InlinePart =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; url: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string };

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; index: string; text: string }
  | { type: "blockquote"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "code"; language: string; lines: string[] }
  | { type: "paragraph"; text: string }
  | { type: "blank" };

export function MarkdownText({ content, role = "assistant" }: MarkdownTextProps) {
  const blocks = parseBlocks(normalizeDisplaySpacing(content));

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => renderBlock(block, index, role))}
    </Box>
  );
}

function renderBlock(
  block: Block,
  index: number,
  role: NonNullable<MarkdownTextProps["role"]>,
) {
  switch (block.type) {
    case "heading":
      return (
        <Box key={index} marginBottom={1}>
          <Text color={getHeadingColor(block.level)} bold>
            {block.text}
          </Text>
        </Box>
      );
    case "bullet":
      return (
        <Text key={index} color="white">
          <Text color="cyan">• </Text>
          {renderInline(block.text, role)}
        </Text>
      );
    case "numbered":
      return (
        <Text key={index} color="white">
          <Text color="cyan">{block.index} </Text>
          {renderInline(block.text, role)}
        </Text>
      );
    case "blockquote":
      return (
        <Box key={index} marginY={0} paddingLeft={1}>
          <Text color="gray">
            <Text color="yellow">▍ </Text>
            {renderInline(block.text, role)}
          </Text>
        </Box>
      );
    case "table":
      return (
        <Box key={index} flexDirection="column" marginY={1}>
          {block.rows.map((row, rowIndex) => (
            <Text key={rowIndex} color={rowIndex === 0 ? "cyan" : "white"}>
              {formatTableRow(row, block.rows)}
            </Text>
          ))}
        </Box>
      );
    case "code":
      return (
        <Box
          key={index}
          flexDirection="column"
          marginY={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text color="gray">
            {block.language ? `code · ${block.language}` : "code"}
          </Text>
          {block.lines.length > 0 ? (
            block.lines.map((line, lineIndex) => (
              <Text key={lineIndex}>{renderCodeLine(line, block.language, role)}</Text>
            ))
          ) : (
            <Text color={getCodeDefaultColor(role)}> </Text>
          )}
        </Box>
      );
    case "paragraph":
      return (
        <Box key={index} marginBottom={1}>
          <Text color="white" wrap="wrap">
            {renderInline(block.text, role)}
          </Text>
        </Box>
      );
    case "blank":
      return <Text key={index}> </Text>;
  }
}

function normalizeDisplaySpacing(content: string) {
  return content
    .replace(/([.!?])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z][a-z])/g, "$1 $2");
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: "code", language, lines: codeLines });
      continue;
    }

    if (trimmed.length === 0) {
      blocks.push({ type: "blank" });
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: (headingMatch[1] ?? "").length,
        text: headingMatch[2] ?? "",
      });
      index += 1;
      continue;
    }

    const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (blockquoteMatch) {
      const quoteLines = [blockquoteMatch[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? "";
        const nextQuote = nextLine.match(/^\s*>\s?(.*)$/);
        if (!nextQuote) {
          break;
        }
        quoteLines.push(nextQuote[1] ?? "");
        index += 1;
      }

      blocks.push({
        type: "blockquote",
        text: quoteLines.join(" "),
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows: string[][] = [];
      while (index < lines.length && isTableLine(lines[index] ?? "")) {
        const current = lines[index] ?? "";
        if (!isTableDividerLine(current)) {
          rows.push(parseTableRow(current));
        }
        index += 1;
      }

      blocks.push({ type: "table", rows });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({ type: "bullet", text: bulletMatch[1] ?? "" });
      index += 1;
      continue;
    }

    const numberedMatch = line.match(/^\s*(\d+\.)\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({
        type: "numbered",
        index: numberedMatch[1] ?? "1.",
        text: numberedMatch[2] ?? "",
      });
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      if (
        nextLine.trim().length === 0 ||
        nextLine.trim().startsWith("```") ||
        /^(#{1,6})\s+/.test(nextLine) ||
        /^\s*>\s?/.test(nextLine) ||
        /^\s*[-*]\s+/.test(nextLine) ||
        /^\s*(\d+\.)\s+/.test(nextLine) ||
        isTableStart(lines, index)
      ) {
        break;
      }

      paragraphLines.push(nextLine);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" "),
    });
  }

  return blocks;
}

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      parts.push({
        type: "text",
        value: text.slice(lastIndex, matchIndex),
      });
    }

    if (match[2]) {
      parts.push({ type: "code", value: match[2] });
    } else if (match[4] && match[5]) {
      parts.push({ type: "link", label: match[4], url: match[5] });
    } else if (match[7]) {
      parts.push({ type: "strong", value: match[7] });
    } else if (match[9]) {
      parts.push({ type: "emphasis", value: match[9] });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: "text",
      value: text.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function renderInline(text: string, role: NonNullable<MarkdownTextProps["role"]>) {
  const parts = parseInline(text);

  return parts.map((part, index) => {
    switch (part.type) {
      case "code":
        return (
          <Text key={index} color={getInlineCodeColor(role)} backgroundColor="black">
            {part.value}
          </Text>
        );
      case "link":
        return (
          <Text key={index} color="blue" underline>
            {part.label}
            <Text color="gray"> ({part.url})</Text>
          </Text>
        );
      case "strong":
        return (
          <Text key={index} color="white" bold>
            {part.value}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={index} color="magenta" italic>
            {part.value}
          </Text>
        );
      case "text":
      default:
        return <Text key={index}>{part.value}</Text>;
    }
  });
}

function renderCodeLine(
  line: string,
  language: string,
  role: NonNullable<MarkdownTextProps["role"]>,
) {
  const segments = highlightCode(line, language);

  return segments.map((segment, index) => (
    <Text
      key={index}
      color={segment.color ?? getCodeDefaultColor(role)}
      bold={segment.bold}
    >
      {segment.text.length > 0 ? segment.text : " "}
    </Text>
  ));
}

function highlightCode(line: string, language: string) {
  if (!line) {
    return [{ text: " ", color: "white" }];
  }

  const normalizedLanguage = language.toLowerCase();
  const tokens = tokenizeCode(line);

  return tokens.map((token) => {
    if (/^\s+$/.test(token) || token.length === 0) {
      return { text: token, color: "white" };
    }

    if (/^\/\/.*$/.test(token) || /^#.*$/.test(token)) {
      return { text: token, color: "gray" };
    }

    if (/^\/\*.*\*\/$/.test(token)) {
      return { text: token, color: "gray" };
    }

    if (/^['"`].*['"`]$/.test(token)) {
      return { text: token, color: "green" };
    }

    if (/^\d[\d._]*$/.test(token)) {
      return { text: token, color: "yellow" };
    }

    if (/^[{}()[\],.;:]$/.test(token)) {
      return { text: token, color: "white" };
    }

    if (/^(=>|===|==|!=|!==|<=|>=|\+|-|\*|\/|=|\||&|<|>)$/.test(token)) {
      return { text: token, color: "magenta" };
    }

    if (isKeyword(token, normalizedLanguage)) {
      return { text: token, color: "cyan", bold: true };
    }

    if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) {
      return { text: token, color: "blue" };
    }

    return { text: token, color: "white" };
  });
}

function tokenizeCode(line: string): string[] {
  const matches = line.match(
    /(\/\/.*$|#.*$|\/\*.*\*\/|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d[\d._]*\b|=>|===|==|!=|!==|<=|>=|[{}()[\],.;:]|[+\-*/=|&<>]|\s+|.)/g,
  );

  return matches ?? [line];
}

function isKeyword(token: string, language: string) {
  const common = new Set([
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "switch",
    "case",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "import",
    "from",
    "export",
    "default",
    "class",
    "extends",
    "new",
    "async",
    "await",
    "type",
    "interface",
    "enum",
    "public",
    "private",
    "protected",
    "true",
    "false",
    "null",
    "undefined",
  ]);

  const shell = new Set(["echo", "cd", "ls", "cat", "grep", "rg", "bun", "git", "export", "if", "then", "fi"]);
  const python = new Set(["def", "import", "from", "return", "if", "elif", "else", "for", "while", "class", "with", "as", "try", "except", "finally", "True", "False", "None"]);

  if (language === "sh" || language === "bash" || language === "zsh") {
    return shell.has(token) || common.has(token);
  }

  if (language === "py" || language === "python") {
    return python.has(token) || common.has(token);
  }

  return common.has(token);
}

function isTableStart(lines: string[], index: number) {
  const current = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return isTableLine(current) && isTableDividerLine(next);
}

function isTableLine(line: string) {
  return line.includes("|");
}

function isTableDividerLine(line: string) {
  return /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line);
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function formatTableRow(row: string[], rows: string[][]) {
  const widths = getTableWidths(rows);
  return row
    .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
    .join("  ");
}

function getTableWidths(rows: string[][]) {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return widths;
}

function getHeadingColor(level: number) {
  if (level <= 1) return "magenta";
  if (level === 2) return "cyan";
  if (level === 3) return "yellow";
  return "white";
}

function getCodeDefaultColor(role: NonNullable<MarkdownTextProps["role"]>) {
  if (role === "tool") return "yellow";
  if (role === "user") return "cyan";
  return "green";
}

function getInlineCodeColor(role: NonNullable<MarkdownTextProps["role"]>) {
  if (role === "tool") return "yellow";
  if (role === "user") return "cyan";
  return "green";
}
