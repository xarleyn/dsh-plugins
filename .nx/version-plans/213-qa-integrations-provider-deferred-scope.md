---
"@yadsh/dsh-qa-integrations": patch
---

The deferred scope of the GitLab and Weblate providers now reads out of one place:
`docs/specs/providers-deferred.md` lists every item the two providers left out,
one row each, with what the code does today, the default already on record for it,
and what actually blocks it.

Until now the same unfinished business was written in three places that overlap and
each disagree: the «Чего в …-провайвере ещё нет» list in README, the `Deferred` and
`Non-goals` sections of each specification, and Weblate's `Future work`, which mixes
what is missing with what was built differently on purpose. Nothing in them said
whether a row waited for a decision or merely for somebody to write it, so the size
of the volume could not be measured without re-reading six documents.

Rows were measured against the code, not against the prose. The measurement closes
the read surface of both providers — 23 of 23 read tools GitLab's §14 names, 19 of 19
Weblate's Tool surface names, all `GET` — so what is deferred is not more reading but
four other things: writes and the single confirmation framework every provider waits
for, an identity-and-boundary choice, the size-and-paging knobs a deployment can set
for Weblate but not for GitLab, and a tail of items that were never going to be
built. The shared blockers are named S1–S4 with the scope each card would carry.

The lane decides nothing here. The OAuth-versus-PAT fork and the nine open questions
of GitLab §37 stay in the `owner-decision` bucket, collected with the recommended
default §37 already carries and with what that default does not settle.

Recording the volume also surfaced five items no list carries, each with the symbol
that shows it: GitLab hard-codes `LIST_MAX_PER_PAGE` and `DIFF_BUDGET` where its §18
names config keys; §36's read-only acceptance checklist still boxes OAuth, resource
restriction, cache namespacing and token refresh; §28's per-instance `oauth.*`,
`tls.caBundle` and `network.*` keys are neither implemented nor listed as deferred;
Weblate's `CONTEXT_HINT` promises the model a search of the developer comment that
`note` — unreachable from any argument — is the one that would perform it; and the
pending-action expiry is written twice, 5–15 minutes in `SPEC.md` §18 and 10–30 in
GitLab §15.

Documentation only: no source file, tool schema or gate changed. README and `SPEC.md`
point at the new document, and each specification's deferred section links to it.
