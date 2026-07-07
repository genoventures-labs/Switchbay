---
id: code-review-pass
name: Code Review Pass
description: Review a diff for correctness, regressions, security, maintainability, and missing tests.
languages: [any]
agents: [reviewer, security, backend, ui-designer]
tags: [review, diff, quality]
triggers: [review, diff, pr, pull request, check this]
---

# Code Review Pass

## Use When

- The user asks for a review.
- A change is ready to inspect before commit or release.
- A risky refactor touches shared behavior.

## Method

1. Inspect the diff and changed files.
2. Prioritize behavioral bugs, data loss, security problems, and broken contracts.
3. Check edge cases, error paths, approval gates, and tests.
4. Separate findings from suggestions.
5. If no issues are found, say so and name residual risk.

## Output

- Findings first, ordered by severity.
- Include file and line references when available.
- Keep summaries brief and secondary.

## Guardrails

- Do not praise before findings.
- Do not list style nits as blocking issues.
- Do not invent line references.
