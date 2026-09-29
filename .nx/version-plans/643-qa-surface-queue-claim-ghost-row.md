---
"@yadsh/dsh-qa-surface": patch
---

A queued question leaves the strip when the turn takes it, instead of staying
behind as a question that has not been sent yet.

A message sent while the agent was answering was admitted by the Host, listed by
its queue and answered in the next turn, yet its row stayed above the composer
marked «отправляется…» with no button on it. The strip drew two different rows for
one send: the queue's own row while the message waited, and a transport row built
from the submission echo the Host registers for it. The echo is supposed to be
retired when the queue accepts the message; while it is listed, the strip folds it
into the queue row it stands for. So an echo that outlives its own claim becomes
visible again the moment the claim empties the queue — a permanent row over a
question the transcript had already answered. Reload made it go away, which is how
the repro proved the state was the browser's, and the visitor typed the question a
second time: the duplicate send under load is exactly what the queue exists to
prevent.

The queue listing the message is the server's own receipt for it, so the surface now
records that fact per binding: a submission once named by the queue is settled, and
the strip reads it from the queue and never again as a question crossing the
transport. The claim frame therefore yields no row at all, while a send the queue
has never named is still marked as crossing, and a message the server holds and has
not claimed keeps its three operations. Entries are forgotten when the Host's
snapshot stops registering them, and the record belongs to the chat that minted the
request ids, so another chat's queue says nothing about this one's sends.

Two limits come with the receipt and are part of this change. It is terminal: the
row disappears completely rather than fading, so a message the Host takes out of
its queue without handing it to the turn leaves neither a queue row nor
«отправляется…» behind. The browser cannot tell that case from a delivered one, and
the alternative was the permanent buttonless row this card reports. And it lives for
one binding: leaving a chat drops the record, so a re-subscription that still finds
an echo the Host has not retired shows the row again until the Host retires it — the
same reason a page reload cleared it on the stand.
