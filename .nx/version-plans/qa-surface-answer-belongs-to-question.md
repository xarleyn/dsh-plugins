---
"@yadsh/dsh-qa-surface": patch
---

An answer belongs to the question that asked it — in the API and in the composer.

Two races, one on each side of a conversation.

`/qa/api/ask` admits a question and then reads the reply back out of the durable
log, and the read chose its turn by "the newest human prompt in this chat". That
is a global counter, not an identity: while two callers hold the same chat, the
second question's row is the newest row there is, so the first caller's read was
cut at the second one's question and published its answer — the bridge posted one
customer's answer under another customer's request, with that turn's citations
attached. Selecting by "latest" also hid the opposite case: a question whose own
turn was cut off before it wrote any text used to be answered with whatever a
later turn had said. The harness already brands each durable prompt row with the
rpc id of the call that wrote it, and the runner now looks for its own row and
reads the turn that row was claimed into — so a question is answered by its own
turn, or, when that turn committed no prose, by nothing at all. The provenance
citation follows the same number instead of the chat's newest bundle, and the
cursor rule is left as the fallback it was written for: a prompt whose row the
read has not reached yet.

The composer staged an attachment after it had chosen the chat to send into. An
upload is a round-trip, and the binding was only tested once the answer came
back — after the state had been written and the prompt dispatched. Leaving for
another chat, or closing the surface, while a file was still going therefore sent
the draft into the chat that had been left, and the chat now on screen inherited
a send that was never its own: its composer stayed busy on a submission it had
not made. The binding is re-checked between the upload and the send, on both
routes that stage files — the model prompt and a human command — and a send whose
chat is gone is dropped instead of landing somewhere else.

The regressions: two concurrent questions in one chat, each with its own marker
in the answer and its own evidence in the turn bundle, pinned to the answer and
the citations its caller receives; a question whose own turn committed nothing
pinned to an empty answer; six projector tests over the row lookup, a batched
turn that answers two questions at once, injected context that must not end a
turn, and a log that names no turn; and three composer tests that switch chats or
dispose the surface in the middle of a stalled upload, pinning that neither chat
received the draft and that the chat the operator moved to is not left reporting a
running send.
