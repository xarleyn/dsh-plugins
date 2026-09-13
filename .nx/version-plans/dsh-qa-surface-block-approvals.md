---
"@yadsh/dsh-qa-surface": minor
---

Answer a composed tool gate's `ask` in the QA view. `interaction.approvals`
now takes `blocked` (default) or `interactive`: an interactive deployment parks
the call on the Host, lists it over the composer with the gate's own reason and
the two stock outcomes (Reject / Allow once), and applies the operator's answer.
A request is Host state, so it survives a page reload, and the turn's own
cancellation settles it when it is never answered. The QA listener is owned by
the plugin context, so it also wraps delegated children, acts only on attested
chats, and never approves anything without a person — the pinned
`approval=never` policy stays the fail-closed backstop.

`interaction.questions` does the same for `ask_user_question`: `unsupported`
(default) refuses the request with a reason the model can act on, because the
stock DSH browser answerer sits behind the QA overlay where nobody can reach it,
while `interactive` parks the request as a form over the composer — one question
at a time with a pager, radio/checkbox options, free text, and explicit skip and
cancel. A skipped question is reported as skipped, never guessed. The tool
itself still has to be mounted by the deployment preset and named in the tool
allow-list.

The same listener keeps refusing a parked `ask` with the QA reason while
approvals are blocked, so a headless `approval=never` decision is no longer
misreported as a user rejection. The per-user path guard supports absolute
`sharedReadOnlyRoots` for reviewed filesystem read tools while keeping every
write inside the account directory, and no longer rejects read-only `dsh_git_*`
tools by name; repository selection remains the responsibility of the
separately configured Git plugin.
