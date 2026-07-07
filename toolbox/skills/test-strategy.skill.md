---
id: test-strategy
name: Test Strategy
description: Choose focused tests based on risk, behavior boundaries, and existing project conventions.
languages: [typescript, python, go, ruby, sql]
agents: [backend, reviewer, debugger, architect]
tags: [tests, verification, quality]
triggers: [test, verify, coverage, regression, failing]
---

# Test Strategy

## Use When

- Adding behavior that should not regress.
- Fixing a bug.
- Touching shared code, command routing, API boundaries, or data transforms.

## Method

1. Identify the behavior contract.
2. Choose the smallest test that would fail before the fix and pass after.
3. Cover edge cases proportional to risk.
4. Prefer existing test style and commands.
5. Run focused tests first, then broader checks if the blast radius is wider.

## Output

- Tests added or skipped with reason.
- Commands run.
- Result summary.
- Residual risk.

## Guardrails

- Do not add snapshot-heavy tests for logic that needs precise assertions.
- Do not fake away the important boundary.
- Do not claim coverage when only build/typecheck ran.
