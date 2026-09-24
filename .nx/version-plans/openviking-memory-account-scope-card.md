---
"@yadsh/dsh-openviking-memory": minor
---

Per-account memory becomes the operator's switch, and the account boundary is stated where it can be read.

The card gains a **Multi-user memory** section carrying `qaUserScoping` — the
option the schema has had since 0.4.0 with nothing in the settings surface able
to set it. Like every other knob, a committed change is re-resolved and reaches
sessions that are already open.

A session that was left alone for want of an account now answers a second time:
`qa_memory_attributed`, with the delay it took. A chat is claimed when its
browser half opens it, which trails the session start, so the lone
`qa_memory_unattributed` line read as lost memory when it was usually only
early; the pair separates the two, and the map behind it is now released with
the session.

SPEC §2.2 and the README name the one path that is **not** per account — the
bridged `mcp__openviking__*` tools run in one child mounted for the process, so a
model-initiated `remember`, `search` or `read` works on the deployment space and
is shared by every account — pin that with a request-level test, and write out
the migration path for memory filed under the deployment identity before
scoping was turned on. §6 gains the scenarios: the master switch pulled live on
an open session, a chat claimed late, a model-initiated write on a scoped
deployment, and the card on the stand's loopback face.
