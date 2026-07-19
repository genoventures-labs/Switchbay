---
id: brief-revise
name: Revise a Brief
description: Rewrite, tighten, or restructure an existing Brief document based on specific feedback.
languages: [any]
agents: [writer, docs]
tags: [brief, document, revise, editing, rewrite]
triggers: [revise, rewrite, tighten, restructure, edit, improve, clean up]
---

# Revise a Brief

## Use When

- A Brief document exists and the user wants it changed.
- The user says "tighten this", "rewrite", "restructure", or "clean it up".
- Feedback is specific (a section, tone, length) or general (the whole thing).

## Method

1. Use `list_canvas_docs` then `read_file` to load the current document content if not already in context.
2. Identify exactly what to change — scope the edit to what was asked.
3. For targeted changes: use `edit_canvas` with `insert_after` or `append` to surgically update a section.
4. For full rewrites: use `edit_canvas` with `replace_all`.
5. Preserve any sections or content the user didn't ask to change.

## Revision modes

- **Tighten** — cut by 20–30%, remove filler, sharpen sentences. Keep every idea.
- **Expand** — add depth to thin sections. Don't repeat what's already there.
- **Restructure** — reorder sections for better flow. Preserve all content.
- **Rewrite** — full new draft using same subject and intent.

## Guardrails

- Do not remove sections that weren't mentioned.
- Do not change the document title unless asked.
- Do not add a preamble before diving in — just make the change.
