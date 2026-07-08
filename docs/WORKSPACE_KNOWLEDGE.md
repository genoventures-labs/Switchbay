# Workspace Knowledge

Workspace Knowledge is Switchbay's local RAG direction: a source-backed map of the active repo/workspace that Bay can use before answering, editing, or running tools.

It is not telemetry, eval dashboards, or a desktop document-chat product. The goal is local confidence:

- retrieve relevant workspace snippets automatically
- cite normal file paths and line spans
- include docs, code, memory, rules, engines, and Skills material
- keep the index readable and stored in the workspace
- make the backend replaceable later

## First Slice

The first implementation is a lexical index stored at:

```text
.switchbay/knowledge/index.json
```

It stores small line-based chunks:

```json
{
  "path": "src/agent/loop.ts",
  "kind": "code",
  "startLine": 520,
  "endLine": 600,
  "text": "..."
}
```

Bay receives top matching chunks in the system prompt as:

```text
WORKSPACE KNOWLEDGE MAP
Source 1: README.md:120-160 [docs]
```

## Commands

```bash
switchbay knowledge
switchbay knowledge refresh
switchbay knowledge search "approval gates"
```

Inside the TUI:

```text
/index
/index refresh
/search approval gates
```

## Roadmap

1. Lexical map with line-span citations.
2. Better source classes for sessions, memories, rules, engines, and Skills.
3. Context budget warnings for retrieved snippets and tool outputs.
4. Optional SQLite FTS backend.
5. Optional embeddings/hybrid retrieval when the simple map stops being enough.
