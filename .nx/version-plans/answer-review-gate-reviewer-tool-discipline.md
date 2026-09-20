---
"@yadsh/dsh-answer-review-gate": patch
---

Both reviewer tasks tell the reviewer not to loop on a failing tool.

The expert task and the subagent task described what to verify and how to
report it, but not what a refused, timing-out or unavailable call means. On a
deployment where one source answers with a timeout and the reviewer's working
directory is empty, the reviewer spent its budget retrying the same endpoint
and reading "no matches" from a path-less search as if the corpus were empty.

Each task now carries the same three rules the expert base policy states: a
failing call has already answered — record it and change the source or the
query instead of repeating it; read tools take an explicit path, and a pattern
without one searches the reviewer's own directory; an unavailable source is
reported, never guessed. The reviewer still reports what it could not verify,
so a failed source remains visible in the verdict rather than silently
absorbed.
