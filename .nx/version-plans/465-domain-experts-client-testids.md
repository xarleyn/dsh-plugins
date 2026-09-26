---
"@yadsh/dsh-domain-experts": patch
---

Every element the domain experts page renders can now be addressed by a stable test id.

The browser half of the plugin carried no `data-testid` at all, so an automated
check could only reach a control through the caption it happened to show or the
class that painted it, and renaming a button or restyling a card broke checks
that never cared about either. Each control, state and shell the client owns now
carries an id prefixed with its zone — `domain-experts-page-*` for the list,
`domain-experts-editor-*` for the editor, `domain-experts-inspector-*` for the
resolved scope — and a shared control takes its id from the call site that
places it, so the same field in two tabs never answers to one selector. A row of
a table holds the id of its template rather than a number, so no index is baked
into a name. 337 distinct values, none of them reused by a second kind of node.

Nothing is displayed differently: only attributes were added, and the plugin's
own checks now find their nodes by id instead of by text, class or placeholder,
while the assertions that were about a role or an accessible name stayed as they
were.
