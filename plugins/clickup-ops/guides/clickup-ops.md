---
id: clickup-ops-quick-start
title: ClickUp Ops Quick Start
kind: quickstart
description: How models should discover and safely use Switchbay's ClickUp engine and workflows.
triggers: [clickup, cup, task, sprint, standup, overdue, project status]
---

# ClickUp Ops Quick Start

- Inspect `clickup` with `list_engine_tools` before using unfamiliar operations.
- Run `clickup_auth` first when configuration or the active ClickUp workspace is uncertain.
- Prefer `clickup_activity` when starting implementation because it combines task details and discussion.
- Use the task, sprint, or work-delivery skill matching the request before assembling multiple calls.
- Read operations may run automatically. Every external mutation requires approval.
- After an approved mutation, read the target again and report the resulting state.
- If authentication fails, stop and ask the user to run `cup init`; never request that a token be pasted into chat.
- The engine is backed by `@krodak/clickup-cli`; use its structured output through engine tools rather than raw shell commands.
