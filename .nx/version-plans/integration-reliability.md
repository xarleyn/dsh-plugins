---
"@yadsh/dsh-openviking-memory": patch
"@yadsh/dsh-documents": patch
"@yadsh/dsh-web-fetch-authenticated": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-git-readonly": patch
---

Retain queued writes when acknowledgement is uncertain and give every replay claim
its own lease. Restore complete cached document bundles, combine cancellation and
request deadlines, bound response bytes and release unused response bodies.
Apply the same authentication rules to redirects and direct requests. Preserve
repository-relative path and literal search semantics in Git tools.
