---
id: brief-outline
name: Outline a Brief
description: Generate a structured outline for a document before drafting, useful for planning longer or complex briefs.
languages: [any]
agents: [writer, architect, docs]
tags: [brief, document, outline, planning, structure]
triggers: [outline, plan, structure, organize, sections]
---

# Outline a Brief

## Use When

- The user wants to plan a document before writing it.
- The topic is complex enough to benefit from a structure first.
- The user says "outline", "structure", or "plan this doc".

## Method

1. Think about the purpose and audience of the document.
2. Identify 4–8 sections that cover the subject completely without overlap.
3. Write the outline as a markdown doc: H1 for title, H2 for each section, a one-line description under each.
4. Use `create_canvas_doc` if no doc exists, then `edit_canvas` with `replace_all` to set the outline.
5. Tell the user the doc is ready and offer to draft any section.

## Output format

```
# Document Title

## Section One
What this section covers in one line.

## Section Two
...
```

## Guardrails

- Sections should be distinct — no overlap between them.
- 4 sections minimum, 8 maximum for a tight outline.
- Don't draft full content unless the user asks.
