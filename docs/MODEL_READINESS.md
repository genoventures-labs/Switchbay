# Model Readiness

Switchbay prepares every provider with the same workspace-owned context before a turn. Model identity can change; project facts, plans, procedures, and evidence remain stable.

For stable preferences that apply across every project on one machine, use the private [`~/.switchbay/context/` user context layer](USER_CONTEXT.md).

## Workspace Profile

`.switchbay/workspace.json` stores compact structured facts: project purpose, detected stack, package manager, commands, important paths, deployment target, related workspaces, and current priorities.

```text
/profile
/profile refresh
```

Generated facts refresh from the workspace while manually maintained priorities, related workspaces, purpose, and deployment target are preserved.

## Durable Plan

The active plan lives at `.switchbay/plans/active-plan.json`. The TUI planner and Planner Engine share this workspace file, and its current/completed steps are injected for every model and future session.

## Automatic Knowledge

Workspace Knowledge refreshes automatically when its index is missing or stale. Discovery excludes environment files, credentials, keys, trace receipts, checkpoints, generated knowledge output, and workflow run state.

Manual controls remain available: `/index`, `/index refresh`, and `/search <query>`.

## Saved Workflows

Workflows are explicit workspace procedures stored under `.switchbay/workflows/`.

```text
/workflow save weekly-report :: Pull sales, verify the requested dates, compare results, and summarize anomalies
/workflows
/workflow weekly-report
/workflow run weekly-report
```

Running a workflow sends its instructions through the normal model/tool loop, so existing grounding and approval gates still apply.

## Context Receipts

Every model turn reports the material context it received, such as the workspace profile, active plan, memory, pins, knowledge sources, workflows, active agent, and MCP state. The same structured receipt is returned by the local API and stored in the Trace Ledger.
