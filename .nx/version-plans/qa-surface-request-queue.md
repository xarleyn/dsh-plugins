---
"@yadsh/dsh-qa-surface": minor
---

A stand can now be told how many questions it is allowed to answer at the same
time, and a visitor whose question does not fit is told so instead of being
answered slowly — or, on a single graphics card, three at once, not at all.

`session.maxActiveRequests` (0 through 50, default 0 = no ceiling) is the
setting; the card shows it in «Сессия». The count it bounds is read on the Host
from the harness's own `running` state of the top-level agents, because that is
the only place the whole load is visible: a browser sees its own chats, never
another account's, and a question that arrived through the HTTP integration API
is invisible to every chat view. Delegated experts ride the turn that delegated
them, so they do not cost a second place.

Before a send the browser asks `qaSurface/queueStatus`, and a full stand holds
the question back where nothing has been spent yet: the draft chat is never
materialized, nothing enters the transcript, and the composer keeps its text —
the visitor reads «Подождите в очереди» with the number of requests the stand
already has in work, closes it, and asks again on the same draft. Refusing after
`prompt` would have been the other option, and it is worse on every axis that
matters here: it creates the chat the issue says must not exist and leaves an
unanswered question in the durable log.

What the ceiling bounds is a question that would wake a second driver. A message
typed while its own chat is answering joins that chat's queue and is admitted
without the read — the driver is busy either way, and a stand capped at one would
otherwise stop a visitor from continuing the conversation it is holding. A human
command rides the Host's command runtime and is never held back: the palette is
how one inspects a saturated stand, and this plugin cannot tell which commands
wake the model. Both enter the same Host count once they do, so the next question
waits behind them as behind any other turn. That count is of the model's load
rather than of this plugin's traffic: any top-level turn the harness is answering
occupies a place, a native assistant's as much as a QA question's, which is the
point of a ceiling set for one weak card.

Two properties are stated rather than fixed, and both come from one fact — the
prompt rides the native session RPC, which this plugin does not own. The ceiling
is a ceiling, not a lock: two questions pressed in the same instant can overshoot
by one, and the next read sees both. And a load the Host cannot report sends the
question anyway, because a deployment that does not know how busy it is has not
earned the right to refuse a visitor.

No behavior changes where the setting stays at its default: with no ceiling
configured the browser asks nothing, so an ordinary deployment keeps both its
send path and its wire traffic exactly as they were.
