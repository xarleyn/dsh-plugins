---
"@yadsh/dsh-qa-surface": patch
---

Pack the generated Typert host and remote-client entrypoints: the `files`
allowlist only kept declarations under `lib/types/`, so the `./remote` and
`./typert` exports previously shipped without their implementation modules
and type definitions.
