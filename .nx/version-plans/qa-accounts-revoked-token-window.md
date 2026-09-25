---
"@yadsh/dsh-qa-surface": patch
---

A revoked account token stops working on the call that presents it.

The Host keeps the accounts in memory and re-reads them when another process
wrote the database — the `qa-accounts` CLI, or a second Host process, since a
password change, a disable or a revocation is an operator act and usually comes
from there. Which call actually re-read was a property of the *caller*:
`whoami`, `currentUser` and the session-ownership checks re-read, while
`requireUser` did not. The personal-skill remotes gate on `requireUser` alone, so
a token revoked a moment ago kept authorizing those calls until some other method
happened to refresh the model — and a browser that only ever opens its own skills
never triggers one.

The refresh itself was also not atomic. `loadAll` took its `PRAGMA data_version`
baseline *after* the SELECTs, so a commit landing mid-read was invisible to it:
the account rows came from before the commit and the baseline from after, which
labeled a model of two database states as current. A revocation that arrived in
that window survived not just the next call but until some later write moved the
version again.

Every credential check now reads the authorization state through one entry point
that refreshes first, so the refusal lands on the call carrying the dead token.
`loadAll` takes the version around its reads and repeats them when the version
moved, which makes the returned model and the baseline describing it one instant;
a database committed into faster than this store can read hands back a model whose
baseline deliberately does not match, so the next access reloads instead of
trusting it.
