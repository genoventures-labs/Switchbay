# Approval Model

Switchbay is built for private and internal use, so it avoids excessive hand-holding for normal local work. Routine file edits, installs, builds, tests, formatting, and git commits run without asking.

Approval is staged for commands with broad, destructive, privileged, or external-impact potential.

## What Always Gates for Approval

### Shell Commands

| Pattern | Examples |
|---|---|
| File removal | `rm`, `rmdir` |
| Git history rewriting | `git push`, `git reset`, `git clean` |
| Publishing | `npm publish`, `bun publish` |
| Privilege escalation | `sudo`, `chmod`, `chown` |
| Disk operations | `dd`, `mkfs`, `fdisk` |
| Remote script execution | `curl | sh`, `wget | bash` |

### Engine Tools

Any engine tool with `"approval": "always"` in its manifest, or with a name matching a configured always-approve pattern (`publish`, `refund`, `delete`, etc.).

### Specific Named Tools

- `gumroad_refund_sale` — always staged, no exceptions
- `route_apply` (Thinkapse) — staged before applying routing changes
- Any create/edit/delete/apply operation via Thinkapse harness

## What Runs Freely

- Read-only shell: `ls`, `cat`, `pwd`, `grep`, `find`, `echo`, `wc`, `head`, `tail`, `curl GET`
- File creation and edits within the workspace
- `mkdir`, `mv`, `cp` within the workspace
- `bun install`, `npm install`, dependency management
- Build and test commands: `bun test`, `bun run build`, etc.
- Code formatting
- `git add`, `git commit` (when the user asked for a commit)
- Engine read-only queries and listing tools

## Approval Flow

When a command is staged for approval, Bay outputs the command and waits. You can:

- **Approve**: type `y`, `yes`, `apply`, or `a`
- **Cancel**: type `n`, `no`, or `cancel`

The approved command is saved and executed once. The approval clears after execution.

## API Approval Routes

When using the local API (`switchbay serve`), pending shell approvals are accessible via:

```bash
# Inspect pending approval
GET /v1/approvals/pending

# Approve
POST /v1/approvals/approve

# Cancel
POST /v1/approvals/cancel
```

See [API_INTEGRATION.md](API_INTEGRATION.md) for the full approval API reference.

## Disabling Operator Safeguards

You can quiet the operator layer (startup overview, daily board, radar) but the core approval gates are not configurable off — they exist because engine tools can issue refunds, push code, and modify production data.

```bash
export SWITCHBAY_OPERATOR=off
export SWITCHBAY_STARTUP_OVERVIEW=off
export SWITCHBAY_DAILY_BOARD=off
```
