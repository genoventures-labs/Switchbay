#!/usr/bin/env bun
const hasCloudKey = process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
const hasLocalLane = process.env.SWITCHBAY_LANE === "local";

if (!hasCloudKey && !hasLocalLane) {
  console.log(`
Switchbay installed.

Pick a lane to get started:

  export OPENAI_API_KEY=...
  export ANTHROPIC_API_KEY=...
  export SWITCHBAY_LANE=cloud

Or use Ollama locally:

  export SWITCHBAY_LANE=local

Then run:

  switchbay
`);
}
