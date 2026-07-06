#!/usr/bin/env node
const hasCloudKey = process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
const hasLocalLane = process.env.HARNESS_LANE === "local" || process.env.ORI_LANE === "local";

if (!hasCloudKey && !hasLocalLane) {
  console.log(`
┌─────────────────────────────────────────┐
│          Code Harness installed ✓       │
├─────────────────────────────────────────┤
│ Pick a lane to get started:             │
│                                         │
│   export OPENAI_API_KEY=...             │
│   export ANTHROPIC_API_KEY=...          │
│   export HARNESS_LANE=cloud             │
│                                         │
│ Or use LM Studio locally:               │
│   export HARNESS_LANE=local             │
│                                         │
│ then run: code-harness                  │
└─────────────────────────────────────────┘
`);
}
