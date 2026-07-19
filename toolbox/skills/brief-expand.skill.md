---
id: brief-expand
name: Expand a Section
description: Deepen a specific section of an existing Brief document with more detail, examples, or reasoning.
languages: [any]
agents: [writer, docs]
tags: [brief, document, expand, detail, writing]
triggers: [expand, add more, flesh out, go deeper, elaborate, detail]
---

# Expand a Section

## Use When

- A section in a Brief document is too thin or high-level.
- The user says "expand", "flesh this out", "go deeper on X", or "add more detail".
- A specific heading or topic is named.

## Method

1. Load the document if not already in context.
2. Locate the target section using the heading as an anchor.
3. Write the expanded content — concrete, specific, no filler.
4. Use `edit_canvas` with `insert_after` and the section heading as anchor.
5. Keep expansion proportional — don't write more than the section needs.

## What good expansion looks like

- Adds a concrete example where there was only a claim.
- Adds reasoning where there was only a conclusion.
- Adds steps where there was only a goal.
- Does not repeat what's already in the section.

## Guardrails

- Only expand the named section — leave everything else alone.
- Do not add a new H2 section; expand within the existing one.
- Do not summarize what you added — just add it.
