---
"@yadsh/dsh-qa-surface": patch
---

The QA page loads from a clean npm installation again.

The browser entrypoint is emitted as one self-contained classic bundle. Mermaid
support can no longer leave relative runtime chunks outside DSH's module table,
and the package and tarball checks reject that broken artifact shape before a
release is published.
