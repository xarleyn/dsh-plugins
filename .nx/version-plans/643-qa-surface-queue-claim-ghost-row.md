---
"@yadsh/dsh-qa-surface": patch
---

A queued question leaves the strip when the turn takes it, instead of staying
behind as a question that has not been sent yet.

A message sent while the agent was answering was admitted by the Host, listed by
its queue and answered in the next turn, yet its row stayed above the composer
marked «отправляется…» with no button on it. The strip drew two different rows for
one send: the queue's own row while the message waited, and a transport row built
from the submission echo the session library registers in this browser for it. The
echo is supposed to be retired when the queue accepts the message; while it is
listed, the strip folds it into the queue row it stands for. So an echo that
outlives its own claim becomes visible again the moment the claim empties the
queue — a permanent row over a question the transcript had already answered.
Reload made it go away, which is how the repro proved the state was the browser's,
and the visitor typed the question a second time: the duplicate send under load is
exactly what the queue exists to prevent.

The queue listing the message is the server's own receipt for it, so the surface now
records that fact per binding: a submission once named by the queue is settled, and
the strip reads it from the queue and never again as a question crossing the
transport. The claim frame therefore yields no row at all, while a send the queue
has never named is still marked as crossing, and a message the server holds and has
not claimed keeps its three operations. Entries are forgotten when the session's own
snapshot stops registering them, and the record belongs to the chat that minted the
request ids, so another chat's queue says nothing about this one's sends.

The receipt is taken from the Host's notification, before the running turn's frame
spacing, and not from the frame that reaches the screen. A question sent while the
agent answers is admitted inside a spacing window, and an absorbed window frame is
dropped rather than replayed: measured on the projected frame, the pair of facts —
the echo the snapshot registers and the message the queue lists — can reach the
browser without ever being seen together, and the claim frame then finds nothing to
settle the send against. That is the row this card reports, restored.

Three limits come with the receipt and are part of this change. It is terminal: the
row disappears completely rather than fading, so a message the Host takes out of
its queue without handing it to the turn leaves neither a queue row nor
«отправляется…» behind. The browser cannot tell that case from a delivered one, and
the alternative was the permanent buttonless row this card reports. It lives for
one binding: leaving a chat drops the record, so a re-subscription whose session
still registers the echo shows the row again until that echo is retired. And the
record falls on the first frame that stops registering the echo, which is what a
session keeping its promise looks like and also what a frame carrying no local echo
looks like — such a frame would draw «отправляется…» over a message the queue had
already named.

None of the three is a cure, and the cure is not in this package. The echo is the
browser's own: `@deepseek-ai/dsh-api-session-controller` — the harness's
`packages/api/session-controller`, pinned here at 0.1.7-rc.2 — describes
`SessionSnapshot.pendingSubmissions` as "Local prompt-submission echoes not yet
observed as durable events or queue occurrences" and `beginSubmission` as "Queued
echoes retire on queue acceptance", that retirement being the `observed` branch of
`PendingSubmissionRetirement`. The follow-up therefore belongs to that retirement
contract on the browser side of the seam, and this surface changes neither it nor
the server: the strip only stops lying to the visitor while it goes unmet. Which
step of it fails is not measured here — the library latches the retirement and
completes it on a later animation frame, and the card's session had its browser
panel collapsed the whole time — so the honest next measurement is the same send
repeated with the panel shown, and the same chat opened in a second tab.
