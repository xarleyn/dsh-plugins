---
"@yadsh/dsh-qa-integrations": patch
---

One owner per shared provider policy, and no empty continuation cursor.

The seven integrations used to carry their own copy of the same helpers: reading
a field out of an upstream answer, refusing a malformed argument, the retry loop
and bounded read of a transport, classifying a failure, naming a configuration
error. The copies had already drifted — the ones that read a string field
disagreed about an empty one — so the same question now has a single answer per
policy, in `providers/shared/` for upstream payloads, paths, HTTP and health,
and in `coerce.ts`/`errors.ts` for arguments and errors. Integrations that
genuinely differ pass a parameter or keep their own named helper; the package
gate refuses a provider that declares a shared policy again.

The behaviour a caller sees: an empty continuation token from Jira is no longer
answered as a cursor. Jira can send `nextPageToken` present but empty, and the
cursor a tool accepts is validated as non-empty, so an answer carrying `""` handed
a caller a value whose only possible use was an `InvalidRequest`; the page is
simply the last one now. The same emptiness rule covers every provider.

While the policies were moving, the integration's specifications moved from
`docs/SPEC-<topic>.md` to `docs/specs/<topic>.md`, and `SPEC.md` — the document
meant to be the single entry point — now links all of them.
