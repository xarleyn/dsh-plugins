---
"@yadsh/dsh-jev-compaction": patch
---

A missing-credential key stays one key, and the file stays text.

The dedupe key for "this provider has no credential configured" joined the
provider and the variable name with a literal NUL byte, which made git treat
`service.ts` as binary — no diff, no review — and the separator is now written
as an escape. The key a running plugin compares is unchanged, so a deployment
that already reported the missing variable once still reports it once.
