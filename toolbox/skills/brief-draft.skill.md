---
id: brief-draft
name: Draft a Brief
description: Create a well-structured document from a topic or prompt, ready to edit in Brief.
languages: [any]
agents: [writer, docs, architect]
tags: [brief, document, draft, writing]
triggers: [draft, write, brief, document, create a doc]
---

# Draft a Brief

## Use When

- The user asks to create, write, or draft a document.
- A topic or subject has been named but hasn't been written out yet.
- The user says "brief", "doc", "write up", or "put together a document".

## Method

1. Use `list_canvas_docs` to check if the document already exists.
2. If it doesn't exist, use `create_canvas_doc` with a clear title.
3. Draft a full markdown document: open with a one-line summary, then sections relevant to the topic.
4. Use `edit_canvas` with `op: "replace_all"` to write the draft.
5. Keep prose tight — say what needs to be said, cut filler.
6. Use headings, bullets, and short paragraphs. Avoid walls of text.

## Structure

- **Opening line** — single sentence that captures the purpose.
- **Sections** — 3–6 focused sections with H2 headings.
- **Each section** — 2–5 sentences or a tight bullet list.
- **No meta-commentary** — don't describe what you're doing, just do it.

## Output

Confirm the document name and file after writing. One line is enough.

## Guardrails

- Do not ask for approval before drafting — just write it.
- Do not pad the document with summaries of other sections.
- Do not use placeholder text or "[insert X here]".
