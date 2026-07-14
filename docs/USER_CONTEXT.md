# Personal User Context

Switchbay gives every model a small, private layer of machine-local context before it sees the current workspace. This is where stable collaboration preferences belong: how you work, what you are focused on, how you like results presented, and standing boundaries.

The default directory is:

```text
~/.switchbay/context/
```

Use `/context` to see what is loaded, `/context path` to print the directory, and `/context read <file>` to inspect one file. Supported files are Markdown, text, and JSON. Files beginning with `.` and unsupported formats are ignored.

## Suggested files

- `profile.md` — name, role, and stable focus
- `working-style.md` — collaboration and communication habits
- `projects.md` — a short, manually maintained active-project map
- `preferences.md` — recurring product and implementation preferences
- `boundaries.md` — standing safety and authority boundaries

Keep project-specific facts in the project's `SWITCHBAY.md`, `.switchbay/workspace.json`, memory, knowledge index, and active plan. The current request and workspace instructions always override global user context.

## Privacy and limits

This directory stays outside Git repositories and is not synced by Switchbay. Do not place credentials, tokens, private keys, passwords, or other secrets in it. Switchbay loads at most 16 files, 4,000 characters per file, and 20,000 characters total so the layer remains compact.

Each completed turn records a receipt such as `user-context:6-files`, making it visible when the layer influenced a model request.
