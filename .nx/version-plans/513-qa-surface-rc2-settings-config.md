---
"@yadsh/dsh-qa-surface": patch
---

The QA surface reads its configuration the way a 0.1.7-rc.2 host publishes it, and its card edits it from its own tab.

On 0.1.5 the plugin installed a settings namespace and the browser bound to it
through a settings scope. The Host rewrote that subsystem: the namespace of an
entry IS its profile entry id, a field is editable while its schema node carries
`.volatile()`, and the browser edits it through `ctx.configForms`. Every
top-level field of this plugin's Config is therefore declared volatile, the
plugin reads the current snapshot of each reference on every operation instead
of holding one resolved copy, and the parts that are not read per operation — the
registered routes, the one-time configuration warnings — re-sync on the Host's
`settings/document-updated` notification for this entry. The generated page is
switched off, because the plugin's own card is the page; the card binds to
`dsh-qa-surface`, the row id the bundle declares, and registers as a tab of the
Plugins settings section under the shell contract it already kept. The key of a
queued message is now read from the session's Inbox projection, since the queue
left the session snapshot; delegated chats are named from the host list rows the
`subagent` origin marks, since the parent-keyed catalog left the list state; a
retained reference replaced the Host-wide `open`; a running tool call reports its
arguments only once it has started; and the notes the plugin injects carry their
own producer kind, because the catch-all `plugin` kind is gone.

Two host facts the compiler surfaced are settled rather than worked around. The
preset registry reads its scope through a revision lease (`acquireScope`), held
for exactly the capability-catalog read that borrowed it, because
`standingKeyFor` was deleted, not relocated. And the `auto` permission preset,
which resolves to `approval: ask`, is now refused as a lockdown preset at
configuration time — the lockdown pins `never` and cannot be weakened, so a
deployment that named `auto` previously only learned it could not attest one
chat at a time.
