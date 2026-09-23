---
"@yadsh/dsh-qa-surface": minor
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-web-fetch-authenticated": minor
---

QA conversations now render Mermaid diagrams with secure source fallback,
documentation search accepts safe grep-style alternatives and canonical paths,
and the role-change dialog uses the surface's normal controls.

Managed integration defaults are provisioned for new users without overriding
an explicit disconnect, explicit review opt-outs bypass the automatic review
gate, and authenticated fetching can retain arbitrary successful responses as
durable file attachments while keeping grants administrator-controlled.
