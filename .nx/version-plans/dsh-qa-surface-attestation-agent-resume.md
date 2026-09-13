---
"@yadsh/dsh-qa-surface": patch
---

Keep a QA chat openable after the Host restarts. DSH materializes an agent on
demand — a session's journal opens straight from persistence, and only
Agent-bound work (a prompt, a model selection, an upload) resolves or resumes
one — so a chat from an earlier Host run had a readable transcript and no agent.
Attestation, the first thing in this surface that needs an agent, refused it
with `agent-unavailable`, and every restored chat was unopenable until something
else in the Host happened to wake it: the sidebar answered «Не удалось открыть
этот чат.», and the startup restore abandoned the previous chat and bootstrapped
a fresh session instead.

Attestation now resumes it. `secureSession` resolves the session through the
Host's session controller before the policy checks, composing the preset that
session recorded — the same composition a stock prompt would produce, so a chat
composed outside the QA preset still lands on the existing mismatch refusals.
The policy is pinned on the resumed agent, and a resume that cannot produce an
agent (a recorded preset that no longer mounts, a log the Host refuses to read)
still refuses, now with the composition detail logged Host-side under
`session.agent-resolve-rejected`. The browser console gained an operator hint
for `agent-unavailable` instead of the generic "facts are in the Host logs"
fallback.
