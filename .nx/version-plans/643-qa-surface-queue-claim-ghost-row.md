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

Naming a message is the server's own receipt for it, and the Host names it in two
of its own lists: the Inbox that holds what waits, and the durable input row it
writes when the turn takes the message. The surface now records either name per
binding — a submission the Host has once named is settled, so the strip reads it
from the queue while it waits and never again as a question crossing the
transport. The claim frame therefore yields no row at all, while a send the Host
has never named is still marked as crossing, and a message the server holds and has
not claimed keeps its three operations. The record is never dropped while the
binding lives: `beginSubmission` mints a fresh `randomUUID` per submission, so an id
the server named cannot belong to a later send, and dropping the receipt is what
lets the survivor come back. It belongs to the chat that minted the ids, so another
chat's queue says nothing about this one's sends.

The receipt is taken from the Host's notification, before the running turn's frame
spacing, and not from the frame that reaches the screen. A question sent while the
agent answers is admitted inside a spacing window, and an absorbed window frame is
dropped rather than replayed: measured on the projected frame, the pair of facts —
the echo the snapshot registers and the message the queue lists — can reach the
browser without ever being seen together, and the claim frame then finds nothing to
settle the send against. That is the row this card reports, restored. Reading the
transcript as well closes the order the Inbox alone cannot: a send admitted *and*
claimed between two notifications is named by no queue frame this browser is
handed, and only its durable row — which outlives the claim and arrives with the
next frame — settles it.

What the record costs and what it does not are both the mask's, not the Host's.
It costs no row the contract would have drawn, because the library has already
committed to the removal by the time either Host list can name the send: the Inbox
frame that lists a queued echo latches the retirement there and then, and so does
the durable row that opens the turn (`client.js:2201` and `:2213`, both handing the
request to `scheduleObservedRetirement` at `:2233`). A message the Host takes out of
its queue without handing it to the turn is therefore not a case the record
swallows — its removal was latched the moment the Inbox listed it, and only the
frame is missing. The retirements the library runs with no frame are the ones for a
send the Host never named at all: the abandon path and a failed prompt
(`client.js:1704`, `:1753`), and the splice reporting `outcome === "canceled"` for a
settlement tracked by insertion receipt, which a queued echo never is
(`client.js:2164`, `:2186`, `:2245`). So the mask differs from the contract by the
clock, never by the outcome. What it costs is the binding:
`unbind()` drops the record, and that runs not only on leaving a chat but also for
a subagent view, a policy re-bind and entering a draft. Only a rebind of the same
Session object could draw a survivor again, and this surface retains under one
source — releasing its reference makes the manager withdraw the instance and
dispose it (`client.js:2413`), so the next binding holds a session with no echoes
at all. Where another holder keeps that object alive, the next Host frame names the
send again and re-earns the record, so the row returns for a frame rather than for
good.

None of this is a cure, and the cure is not in this package. The echo is the
browser's own: `@deepseek-ai/dsh-api-session-controller` — the harness's
`packages/api/session-controller`, pinned here at 0.1.7-rc.2 — describes
`SessionSnapshot.pendingSubmissions` as "Local prompt-submission echoes not yet
observed as durable events or queue occurrences" and `beginSubmission` as "Queued
echoes retire on queue acceptance", that retirement being the `observed` branch of
`PendingSubmissionRetirement`. It does not happen at acceptance. In the pinned
bundle `scheduleObservedRetirement` (`lib/client.js:2233`) latches the settlement
and hands `finishSubmission` to `scheduleFrame` (`lib/client.js:2309`), which calls
`requestAnimationFrame` and takes the macrotask only where that function does not
exist at all. The follow-up is that one step: retire a settlement a delivered
notification already proved without waiting for a frame — or take the macrotask
whenever the frame clock stops, not only where there is no `requestAnimationFrame` —
since a surface that gets no frames never runs the removal. This surface changes
neither that contract nor the server: the strip only stops lying to the visitor
while it goes unmet.

So the mask has one proven case and one predicted, and the seam between them is the
frame clock. The card measured the browser panel collapsed (`viewport=0x0`), where
the deferred removal cannot run while the snapshot notifications keep arriving —
those are published on microtasks by the same package — so the feed moved and the
row stayed: that is the branch this change fixes, and the branch the repro is in.
With the panel shown and the tab focused, the same mechanism predicts the row leaves
by itself one frame after the claim, and the mask then holds the dock to its own
promise rather than a symptom a visitor saw — "a row that left the queue must not
keep anything" (`QaQueueDock.tsx:148`). The measurement that separates the two is
the card's repro repeated with the panel open and the tab active, on a short turn,
and it is not taken here.
