---
"@yadsh/dsh-domain-experts": patch
---

The built-in expert policy tells experts how to work tools without looping.

Every domain inherits one base policy, and it said what to do with evidence
but nothing about the way a run goes wrong: an expert that hits a refused,
timing-out or unavailable tool kept retrying it — and near-variants of it —
burning the steps it was given instead of moving to another source. A live
review run showed exactly that: two calls to an MCP endpoint that answers with
a timeout, then more attempts of the same tool, and a `grep` without a path
that searched an empty working directory and reported "no matches" as though
the corpus were empty.

The policy now carries three rules: a call that errors, times out or is
refused has already answered (record it, change the source or the query, never
repeat the call); read tools take an explicit path, so a bare pattern proves
nothing about the sources the expert was pointed at; and a source that is
unavailable for the run is reported as unavailable rather than replaced with a
guess. Domain instructions still append to this text — it is a floor, not a
replacement.
