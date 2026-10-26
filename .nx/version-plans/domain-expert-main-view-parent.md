---
"@yadsh/dsh-domain-experts": patch
---

Use the main view's retained Session as the expert test caller on Host 0.2,
while preserving legacy selection support and refusing unrelated references.
Apply configured tool restrictions on the reserved local child's scoped registry
before its first prompt; refuse unknown tools and unsupported remote backends.
