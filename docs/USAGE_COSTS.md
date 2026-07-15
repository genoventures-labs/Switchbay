# Usage and Cost Estimates

Run `switchbay usage` in the CLI or `/usage` in the TUI to see traced turns, token estimates, tool activity, routing graphs, and approximate API spend for the latest session, today, the last seven days, and the retained workspace trace lifetime.

Switchbay calculates spend from estimated prompt/answer tokens and a small built-in table of standard first-party API list prices. Local Ollama turns have `$0.00` marginal API cost. Unknown custom models, OpenRouter, hosted Hugging Face, and Ollama Cloud remain explicitly unpriced unless you provide a rate.

Override or add rates with USD per one million input/output tokens:

```bash
export SWITCHBAY_MODEL_PRICING_JSON='{
  "openai/my-model": { "input": 1.25, "output": 5.00 },
  "provider-model-id": { "input": 0.50, "output": 2.00 }
}'
```

These are estimates, not billing records. They exclude unobserved reasoning tokens, caching adjustments, provider tool/search charges, taxes, discounts, regional multipliers, subscription allowances, and local electricity or hardware costs.
