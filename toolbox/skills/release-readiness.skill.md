---
id: release-readiness
name: Release Readiness
description: Prepare a repo for version bump, changelog-level summary, release asset, and install verification.
languages: [any]
agents: [devops, reviewer, docs]
tags: [release, version, brew, ci]
triggers: [release, ship, version, tag, brew, publish]
---

# Release Readiness

## Use When

- The user says ship, release, version, tag, publish, or push to Homebrew.
- A feature batch needs final verification.

## Method

1. Confirm the working tree scope.
2. Run tests, typecheck, build, and diff hygiene checks.
3. Commit feature work before version bump scripts that require a clean tree.
4. Run the release script or documented release command.
5. Verify tag, version output, release asset, and install metadata.
6. Patch release automation if it would recreate a known packaging bug.

## Output

- Version released.
- Commits/tags pushed.
- Verification results.
- Any install caveat, especially private/public asset visibility.

## Guardrails

- Never tag a dirty tree unless the release process explicitly requires it.
- Do not hide failed asset or install checks.
- Keep release-script fixes committed after release when needed.
