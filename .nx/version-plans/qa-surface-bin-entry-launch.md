---
"@yadsh/dsh-qa-surface": patch
---

`qa-accounts` answered with nothing when a stand ran it through the installed
bin.

A package manager installs a bin as a link, and Node resolves the entry point
with `fs.realpath`: the process is handed the link path while the module knows
the file it links. The launch guard compared those two paths as spelled, so the
entry never matched, `main` was never called, and every command printed nothing
and exited 0 — `list` on a database full of accounts read as "the stand has no
accounts", and `add` reported success while writing nothing. The guard resolves
both sides now, so a link behaves like the file it links; `qa-repair-sessions`
and `qa-attach-sessions` compared the same way and are fixed the same way.

The silence is bounded at pack time, where it cannot cost an operator an
afternoon: package verification launches every bin through a
`node_modules/.bin`-style link and requires a real answer — the usage text, and
`list` against an empty database — and checks the node shebang that lets a bare
`qa-accounts list` reach Node at all. A launch that goes quiet now fails the
release instead of the deployment.
