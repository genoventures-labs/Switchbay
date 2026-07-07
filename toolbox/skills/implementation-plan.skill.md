---
id: implementation-plan
name: Implementation Plan
description: Turn a feature request into a scoped, testable implementation path.
languages: [any]
agents: [architect, backend, ui-designer, devops, docs]
tags: [planning, implementation, scope]
triggers: [build, implement, add, roadmap, next]
---

# Implementation Plan

## Use When

- The user asks to build or change a feature.
- The task spans multiple files or behavior surfaces.
- The right order matters.

## Method

1. Read the existing code shape first.
2. Name the smallest useful outcome.
3. Split the work into context, implementation, verification, and handoff.
4. Prefer local patterns and helper APIs.
5. Add tests where the blast radius justifies them.
6. Keep unrelated refactors out.

## Output

- Short plan when helpful.
- Concrete file changes.
- Verification commands.
- Clear status at the end.

## Guardrails

- Do not stop at a proposal when implementation is feasible.
- Do not add abstractions unless they remove real complexity.
- Do not overwrite unrelated user changes.
