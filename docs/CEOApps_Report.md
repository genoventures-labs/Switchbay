Our next play is **not another feature lane**.

It’s **Switchbay Trace / Replay**: the local “flight recorder” for every AI coding session.

Workspace Knowledge RAG gives Switchbay better context. The next wedge should prove Switchbay is **trustworthy when it acts**.

Switchbay already has the bones: terminal-first workbench, cloud/local lanes, MCP bridge, memory, sessions, approvals, Engine Bay, Toolbox, Web Engine, and local file/tool actions. The README positions it as “the workbench around the model,” not just a chat UI.  The package is already public, MIT, v0.9.79, and explicitly describes Switchbay as a terminal-first AI coding workbench with cloud/local model lanes and MCP bridge.

So the next strategic move is:

**Workspace Knowledge RAG → Trace/Replay Layer → Eval Bench → 1.0**

The core product promise becomes:

“Switchbay doesn’t just help you code. Switchbay shows what it knew, what it touched, why it acted, what changed, and whether the result held.”

That is stronger than “local coding agent.” Claude Code and others already own the broad agentic coding lane; Claude Code is positioned as reading codebases, editing files, running commands, and integrating across terminal, IDE, desktop, and browser. ([Claude Platform Docs][1]) Switchbay wins by being the **inspectable, local-first control plane**.

What I’d build next:

**1. Session Flight Recorder**

Every turn gets a durable record:

User prompt.
Active lane/model.
Injected context.
Workspace Knowledge chunks used.
Tool calls.
Shell commands.
Approval decisions.
Changed files.
Diffs.
Test/build results.
Errors.
Final answer.
Token/context budget warnings.

Right now the RightRail shows runtime, agent feed, workspace dirty state, changed files, and recent activity, which is the perfect UI seed. But it’s mostly “live visibility,” not yet a durable evidence ledger.  Turn that rail into a session artifact you can reopen, search, export, and replay.

**2. `/trace` and `/replay`**

Add simple commands:

`/trace` shows the current turn’s evidence/actions.
`/trace last` opens the last completed turn.
`/trace export` writes `.switchbay/traces/<session>/<turn>.json`.
`/replay last` reruns the same prompt against the same repo state/context plan where possible.
`/why` explains why Switchbay chose a file, tool, command, or retrieved chunk.

This becomes the magic: not “Switchbay said it fixed it,” but “Switchbay touched these files, because these chunks/tools led it there, and tests passed/failed here.”

**3. Approval History as Product, Not Just Safety**

Switchbay already gates destructive or broad-impact actions like `rm`, `git push`, `git reset`, publish commands, `sudo`, permission changes, disk tools, and shell-piped remote scripts.  The next step is making those approvals auditable.

For every risky action: show the command, reason, before/after state, result, and whether the user approved, denied, or marked always-allow. That is a trust differentiator, especially for local AI power users.

**4. RAG Diagnostics Panel**

Since Workspace Knowledge RAG is current, don’t stop at “retrieved chunks.” Make the trace include:

What was retrieved.
What was not used.
What chunk won and why.
Whether the final answer cited evidence.
Whether the context budget got squeezed.
Whether Switchbay answered from repo facts, memory, or model prior.

That maps exactly to the Reddit report’s strongest wedge: “evidence-backed local workspaces,” not “better local LLM chat.”  Open WebUI and AnythingLLM already expose RAG, chunking, reranking, full-context/partial-context tradeoffs, and citations, so the opportunity is not “we have RAG too.” It’s helping users see when RAG failed and why. ([Open WebUI][2]) ([AnythingLLM][3])

**5. Then Eval Bench**

Don’t build Eval Bench before traces. Build it on top of traces.

A saved trace becomes an eval case:

“Question should retrieve file X.”
“Answer must cite line Y.”
“Command must not run without approval.”
“Patch should touch only these files.”
“Tests should pass after edit.”

That gives Switchbay a serious moat: reproducible local AI work. The Reddit report’s proposed Eval + Tuning Bench is the right expansion, but it becomes much easier and more productized once traces exist.

My call:

**Do not jump to desktop app, team server, marketplace, or public GTM yet.**

Get to a sharp **1.0 private-power-user build** with:

Workspace Knowledge RAG
Trace ledger
Replay/export
Approval history
Context budget diagnostics
One killer demo repo/document folder
Clean README section: “Inspect every answer and action”

Then launch the narrative as:

**“The local-first AI coding workbench with receipts.”**

That’s the line, bro. Not “Claude Code clone.” Not “terminal chatbot.” Not “RAG app.”

**Switchbay is Switchbay with receipts.**

[1]: https://docs.anthropic.com/en/docs/claude-code/overview "Overview - Claude Code Docs"
[2]: https://docs.openwebui.com/features/rag/ "Retrieval Augmented Generation (RAG) | Open WebUI"
[3]: https://docs.anythingllm.com/chatting-with-documents/introduction "Using Documents in AnythingLLM ~ AnythingLLM"
