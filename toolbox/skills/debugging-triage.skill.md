---
id: debugging-triage
name: Debugging Triage
description: Isolate a bug with hypotheses, falsification checks, and minimal reproduction steps.
languages: [any]
agents: [debugger, backend, ui-designer, devops]
tags: [debugging, triage, reproduction]
triggers: [bug, broken, failing, error, empty response, weird]
---

# Debugging Triage

## Use When

- Something fails, hangs, returns empty output, or behaves differently than expected.
- The user gives symptoms but not a confirmed cause.

## Method

1. Restate the symptom and the expected behavior.
2. Identify the smallest boundary that can explain it.
3. Form one hypothesis at a time.
4. Run the cheapest check that could falsify the hypothesis.
5. Keep a short evidence trail.
6. Patch only after the cause is likely enough.

## Output

- Current best read.
- Evidence found.
- Fix applied or next check.
- Remaining uncertainty.

## Guardrails

- Do not refactor while the cause is unknown.
- Do not treat symptoms as root cause.
- Prefer logs, tests, and direct reproduction over guesses.
