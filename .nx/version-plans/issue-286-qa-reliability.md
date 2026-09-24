---
"@yadsh/dsh-qa-surface": minor
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-answer-review-gate": minor
"@yadsh/dsh-web-fetch-authenticated": minor
---

QA conversations now render Mermaid diagrams with secure source fallback,
documentation search accepts safe grep-style alternatives and canonical paths,
and the role-change dialog uses the surface's normal controls.

Managed integration defaults are provisioned for new users without overriding
an explicit disconnect, the structured `/no-review <request>` command bypasses
the automatic review gate for exactly one durably linked request, and
authenticated fetching can retain arbitrary successful responses as durable
file attachments while keeping grants administrator-controlled.
