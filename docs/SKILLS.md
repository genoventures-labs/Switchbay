# Skills

Skills are Switchbay's reusable working-method layer. Where engines give agents callable machinery, Skills give Switchbay reusable procedures — portable SOPs that agents read and apply during a session.

Skills are markdown files with frontmatter. They are human-readable, GitHub-syncable, and injected into session context as concise operating guides.

## Built-In Skills

| Skill ID | Purpose |
|---|---|
| `api-contract-check` | Verify API contract compliance |
| `code-review-pass` | Structured code review walkthrough |
| `debugging-triage` | Systematic bug investigation method |
| `implementation-plan` | Break down and plan a feature build |
| `release-readiness` | Pre-release checklist and audit |
| `test-strategy` | Design a testing approach for a feature |
| `ui-polish-pass` | UI refinement and accessibility review |
| `web-research` | Guided web research and citation method |

## CLI

```bash
switchbay skills             # show inventory and sync status
switchbay skills sync        # pull latest from GitHub
switchbay skills list        # list all available skills
switchbay skills templates   # list skill templates
switchbay skills read release-readiness
```

## TUI

```text
/skills
/skills sync
/skills list
/skills templates
/skills read release-readiness
```

The TUI auto-checks for skill updates on startup and prompts to sync with a single keypress if a new version is available.

The older `toolbox` command remains as a compatibility alias.

## Syncing From GitHub

By default, Skills sync from:

```text
https://github.com/genoventures-labs/Engine-Toolboxes.git
```

into `~/.switchbay/toolbox/Engine-Toolboxes`. Override with:

```bash
export SWITCHBAY_TOOLBOX_REPO=https://github.com/you/your-toolbox.git
export SWITCHBAY_TOOLBOX_PATH=~/.switchbay/toolbox/Engine-Toolboxes
```

## Creating a Custom Skill

Use the conversational builder in the TUI:

```text
/create-skill
```

Or write a markdown file directly with this template:

```markdown
---
id: my-skill
name: My Skill
description: A reusable working method that Switchbay agents can apply during a session.
languages: [any]
agents: [any]
tags: [workflow]
triggers: [when this should be used]
---

# My Skill

## Use When

## Method

## Output

## Guardrails
```

Save it to:
- `.switchbay/plugins/<id>/skills/my-skill.skill.md` (plugin-scoped)
- Workspace toolbox (via `/create-skill`)

## Skill Sources

Switchbay loads skills from (in priority order):

1. Built-in skills bundled with Switchbay
2. Synced skills from the GitHub Engine Toolboxes repo
3. Workspace-local skills in `.switchbay/`
4. Plugin-bundled skills from `.switchbay/plugins/*/skills/`

If two skills share the same ID, the later source wins (workspace overrides synced, which overrides built-in).

## Model Tools

| Tool | Description |
|---|---|
| `list_toolbox_skills` | List all available skills and their metadata |
| `read_toolbox_skill` | Read the full body of a skill by ID |
| `sync_toolbox` | Pull the latest skills from the remote GitHub repo |
