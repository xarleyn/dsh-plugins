---
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-tool-offload": patch
"@yadsh/dsh-jev-compaction": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-session-audit": patch
"@yadsh/dsh-preset-persona-editor": patch
---

Preserve safety checks across stream boundaries and retain structured metadata and
downstream decisions when processing tool results. Reserve delegation capacity
before asynchronous startup and release it on completion while retaining child
identity. Retire stale watchers and ignore obsolete editor responses.
