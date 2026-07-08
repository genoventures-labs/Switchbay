---
id: web-research
name: Web Research
description: Read current public web sources through Switchbay's guarded Web Engine.
languages: [any]
agents: [any]
tags: [web, research, docs, source-checking]
triggers: [latest, current, docs, source, web, url, verify online]
---

# Web Research

## Use When

- The user asks for current, recently changed, or source-backed information.
- A specific URL, docs page, release note, article, or repository page needs to be checked.
- Local context is insufficient and the answer should be grounded in external public sources.

## Method

1. Prefer explicit URLs from the user or from known project documentation.
2. Use `web_fetch` for readable page text, `web_headers` for status/content checks, and `web_links` to find linked docs from a known public page.
3. Keep the web pass narrow: fetch only the pages needed to answer the question.
4. State what the source says, then separate any inference from the fetched facts.
5. Include the source URL in the answer when web facts affect the conclusion.

## Output

- Concise answer first.
- Source URLs after the relevant claim.
- Mention if a page could not be fetched, was truncated, or did not contain enough evidence.

## Guardrails

- Do not browse private, localhost, LAN, metadata, or internal addresses through Web Engine.
- Do not imply live verification unless a web tool actually succeeded.
- Do not use web text to perform secrets discovery, auth bypass, scraping at scale, or policy evasion.
