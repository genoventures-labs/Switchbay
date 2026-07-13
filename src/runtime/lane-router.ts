export type LaneSuggestion = { lane: "local"; reason: string };

export function suggestRuntimeLane(input: string): LaneSuggestion | null {
  const text = input.trim().toLowerCase();
  if (!text || text.startsWith("/")) return null;
  if (/https?:\/\/|\b(image|screenshot|vision|research|latest|current|browse|internet|deploy|publish|push|pull request|github|mcp|external)\b/.test(text)) return null;
  if (/\b(architecture|architect|implement|refactor|debug|investigate|many files|entire repo|security audit|migration|database schema)\b/.test(text)) return null;
  if (/\b(private|privacy|sensitive|confidential|offline|keep (?:this|it) local)\b/.test(text)) {
    return { lane: "local", reason: "The request is privacy-sensitive and can stay on this Mac." };
  }
  if (/\b(summarize|rewrite|rephrase|format|classify|extract|brainstorm|outline|title|shorten|proofread|explain)\b/.test(text) && text.length <= 700) {
    return { lane: "local", reason: "This is a contained, lightweight language task." };
  }
  if (/\b(read|inspect|list|describe)\b/.test(text) && /\b(file|document|text|markdown|json|csv)\b/.test(text) && text.length <= 500) {
    return { lane: "local", reason: "This is a small, contained local-file task." };
  }
  return null;
}
