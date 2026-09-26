---
"@yadsh/dsh-qa-integrations": patch
---

A provider that answers with its headers and then stops sending its body is
refused by the request's own budget instead of being waited on forever.

`timeoutMs` was the deadline of the headers. The transport loop armed its timer
for an attempt and cleared it the moment a `Response` arrived, and the `Response`
was handed back unread — so the body was read after the budget had already
expired, and nothing in that read observed the deadline at all. A slow or stalled
upstream therefore outlived the timeout it was supposed to be bounded by, and the
call stayed pending: the model waited on a request this deployment had already
given up on. Seven transports went through the one loop, so all seven had it; the
three that kept a private copy of the loop had it along with the rest of what a
copy drifts into — Confluence folded its own timeouts into
`ProviderUnavailable` and never learned the `UpstreamTimeout` its siblings
report, and Bitrix24 folded a body that stopped arriving into
`ProviderUnavailable` too, which reads as "the portal is down" where the truth is
"this call is over its budget".

The deadline now covers the whole exchange. The loop reads the answer through a
callback it holds itself, so its timer is cleared in the outer `finally`, after
the body is done, and each chunk is raced against the attempt's own signal;
whatever ends the read — the cap, the deadline, a transfer that broke halfway —
releases the stream, so no body keeps a connection open past the request it
belongs to. A read cut by the deadline is `UpstreamTimeout`, in words that name
neither the address nor the credential, and a refusal the read made on its own
(too large, not JSON) stays what it was named as: it is an answer, not a fault.
A fetch that answered is still not re-sent, so one attempt's budget is the whole
cost. Confluence's private loop is gone — it goes through the shared one now,
with its own status map expressed as the policy parameters the shared folding
takes, which is the shape `providers/README.md` asks for and one copy of the
retry rule instead of two.

The behaviour is pinned in the shared conformance suite, so every provider is
held to the same deadline over its own body read, and additionally at the level
of the reader and the loop themselves; Bitrix24 keeps a test of its own that its
stalled body is told apart from a refused operation, since it answers both
through one `catch`.
