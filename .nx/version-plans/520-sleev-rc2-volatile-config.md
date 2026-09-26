---
"@yadsh/dsh-sleev": patch
---

The observer reads its own settings, and its card moves to the Plugins tab.

`0.1.7` unified the two configuration surfaces a plugin used to keep: a field is
editable in the browser when its schema node says so, and the settings namespace
is the profile entry that owns it. The observer's four fields — exact routes,
route prefixes, recent-call retention and telemetry logging — are now declared
`.volatile()`, so the Loader serves the `dsh-sleev` entry itself as the namespace
the card edits, and the separately registered `sleev` section is gone. The card
follows the Host surface that survived the rewrite, the Plugins tab of Settings,
and resolves the form through `ctx.configForms`; it keeps the shared card shell,
with the `<li>` root inside the list element this plugin owns.

Reading changed shape, not meaning. The volatile reference is stable and its
value is swapped in place, so the observer takes one snapshot per operation
instead of keeping a source callback the settings layer pushed a newer object
into; a committed edit still reaches the next matching call without a restart.
The logger level follows on the first read that sees a different value, because
the Loader commits a volatile change without re-constructing the service. The
card still stages edits, marks the unsaved fields, resets one field to its
composition default, and refuses to save a value the schema would reject. Which
routes are observed, what is retained, and what is never stored are untouched.

Two scripts came along for the ride. `smoke:packed` pinned its default harness
version to `0.1.1-rc.2` — an island no dependency had stood on for several
releases, so the smoke tested a composition nobody ships; it now reads the last
entry of `compatibility.json → testedReleases` and refuses an override outside
that list, which is what its neighbours already do. The live `smoke:neuraldeep`
script builds its conversation through the current message shapes: a plugin-
authored user turn is a plain user source, the tool result is a `tool`-role
message answering its call id, and the assistant source no longer restates its
own kind.
