---
"@yadsh/dsh-domain-experts": minor
"@yadsh/dsh-qa-surface": minor
---

Expert memory can be maintained, and junk stops being recorded.

The QA admin console gained a "Expert memory" section: the records an expert
wrote to itself, listed per domain, searchable, correctable and deletable one at
a time or as a selection. A reviewer reads it; only an administrator writes it,
and every write is audited with the line as it was before.

On the write path, the `domain_memory` tool now refuses a note that records
nothing — an acknowledgement, a placeholder, an echoed command, or "nothing was
found" — and answers with the reason, so a wrong line stops being injected into
every later answer of that domain by the same expert that wrote it. Operators
are not gated: correcting or emptying a record from the console stays allowed.
