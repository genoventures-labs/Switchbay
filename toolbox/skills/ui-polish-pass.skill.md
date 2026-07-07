---
id: ui-polish-pass
name: UI Polish Pass
description: Improve a UI for hierarchy, usability, responsiveness, accessibility, and visual fit.
languages: [typescript, javascript, css, html]
agents: [ui-designer, reviewer]
tags: [ui, frontend, accessibility, design]
triggers: [ui, design, polish, frontend, layout, responsive]
---

# UI Polish Pass

## Use When

- Building or reviewing a user-facing screen, TUI surface, or interaction.
- The user asks to make the interface feel better or more complete.

## Method

1. Identify the primary workflow and target user.
2. Check hierarchy, density, empty states, loading states, and error states.
3. Check keyboard flow, focus behavior, contrast, and responsive layout.
4. Prefer existing components and visual conventions.
5. Verify with screenshots or rendered output when available.

## Output

- Concrete UI changes.
- Accessibility and responsiveness notes.
- Verification method.

## Guardrails

- Do not create marketing-style landing pages for tools.
- Do not introduce one-off visual systems without need.
- Make text fit its container on mobile and desktop.
