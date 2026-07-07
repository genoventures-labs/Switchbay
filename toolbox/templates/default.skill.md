---
id: my-skill
name: My Skill
description: A reusable working method that Switchbay agents can apply during a session.
languages: [any]
agents: [any]
tags: [workflow]
triggers: [when the user asks for this kind of help]
---

# My Skill

## Use When

- The user asks for a repeatable workflow.
- The task benefits from a known checklist, pattern, or operating procedure.

## Inputs

- Current workspace context.
- User goal.
- Relevant files, logs, schemas, or command output.

## Method

1. State the goal in one sentence.
2. Gather only the context needed for the next decision.
3. Apply the checklist or workflow.
4. Produce a concrete result, patch, plan, review, or recommendation.

## Output

- Keep the answer concise.
- Name files, commands, or decisions that matter.
- Include follow-up steps only when they are genuinely useful.

## Guardrails

- Do not invent project facts.
- Do not run destructive or external-impact actions without approval.
- Prefer the repo's existing conventions over new patterns.
