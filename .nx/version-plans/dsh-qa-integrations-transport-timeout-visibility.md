---
"@yadsh/dsh-qa-integrations": patch
---

A provider that stops answering now says so.

A read that timed out against Jira, Confluence, TeamCity, TestIT, Bitrix24 or
the others left no trace: the plugin logged credential events and address-policy
warnings only, so an operator looking at the stand's journal could not tell a
slow tracker from a broken one, and the conversation showed neither a tool
timeout nor an upstream failure.

Every error the retry loop gives up with now carries the budget it spent — the
per-attempt timeout, the retries, the attempts actually made — and the broker
warns once, with `transport.timeout`, naming the provider and the operation.
Nothing upstream is written to the log: no address, no query, no body, no
credential. The tools also declare a ceiling of their own (300 s), computed from
that retry budget and below the answer budget the QA surface owns, so the harness
can end a stalled call instead of waiting for the caller to give up.
