#!/usr/bin/env node
const hasKey = process.env.ORI_API_KEY?.trim();

if (!hasKey) {
  console.log(`
┌─────────────────────────────────────────┐
│           ORI Code installed ✓          │
├─────────────────────────────────────────┤
│ Add your API key to get started:        │
│                                         │
│   export ORI_API_KEY=glm.<prefix>.<key> │
│                                         │
│ Add that to ~/.zshrc or ~/.bashrc       │
│ then run: ori-code                      │
└─────────────────────────────────────────┘
`);
}
