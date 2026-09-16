---
"@yadsh/dsh-qa-surface": patch
---

Name only inheritable tools in a scoped restriction. The QA tool catalog
attaches its tools to the agent itself, and `tools.restrict()` accepts only the
names a scope inherits: the activation diagnostic is mounted, callable and
still unnameable in a mask. Passing it made the registry refuse the whole call,
so every chat's attestation failed with `unknown global tool
"qa_tools_selfcheck"` and the session was rejected. The base tool set now keeps
that name out of the mask while the policy and the guard keep admitting it, and
a skill grant for a tool the agent registers for itself is accepted without a
mask of its own — the same name used to make every grant attempt collapse
silently.
