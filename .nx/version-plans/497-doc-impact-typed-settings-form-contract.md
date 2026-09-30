---
"@yadsh/dsh-doc-impact": patch
---

The settings card reads a settings document that is not what its fields promise
without showing a value it cannot edit.

The card edits ten fields through one nested namespace document, and until now
the address of each field, the kind of control it draws and the draft it may hold
were carried by untyped values: `any` at the read, `any` at the staged operation.
A staged `clear` for a text field and a staged text for a choice field looked the
same to the compiler, so the mistake an edit could introduce would only show up
when Save wrote it. Every field now carries one discriminated spec — its kind
decides the draft the field can stage, and the draft decides the value type — so
an operation that cannot belong to its field stops at the type check instead of
reaching the Host. The faces the form reaches the Host through are the settings
package's own types now, not a mirror written out by hand: nothing could check
such a mirror, since the client entry declares its own context, and this one had
already lost the `mode` the Host puts in every snapshot and the `set`/`unset` it
answers with. The package is declared as a peer dependency for that type check;
the shipped bundle still requires nothing but react, because the import carries no
value.

Two readings of the Host document became honest readings. The document is raw
profile JSON, and the field specs only describe its shape: where a field promises
a scalar and the layer holds an object or an array instead, the card now shows the
default the field would fall back to rather than carrying that node into the
field's value (an unchecked cast used to do the latter). A choice additionally
refuses a value outside the vocabulary its spec offers: such a value used to reach
the select, which then has no `option` to mark selected and reads back as an empty
box — so the operator saw nothing where the Host held a string. The field now
stands on its fallback like any other unset one, keeps its override badge, and can
still be written over. And the Host hands out a settings form for any name asked
of it, served or not, so the card asks the service that knows instead: the tab is
claimed only while the namespace is served, where before it was claimed
unconditionally and an unserved namespace left an empty tab on the Plugins page.

What the card writes is unchanged. Drafts still never write before Save, Save
still commits field-granular path operations in staging order, a save that did not
land keeps its drafts, and a reset still drops the user layer instead of copying
the composition base into it — that last one is now pinned for every kind of
field, and the defaults and vocabularies the card repeats are pinned against the
plugin's own configuration schema. Which field the card draws is pinned too: every
spec must reach exactly one control of the kind it declares, and a default the card
repeats by hand has to be the one its spec carries, so a field that joins the
schema and the specs without joining the screen is now a failing test rather than
an invisible gap.

One thing the entry owed and did not keep. The Host answers a disposer for the
watch on a namespace and for the listener on the settings controller, and the entry
threw both away as soon as they were handed to it, keeping nothing to roll back on
teardown. It now answers the rollback the client contract asks for: the watch and
the card's listener are ended together, and a test over the built bundle holds the
Host to the shape it declares — the tab is gone and the controller has no listener
left after the entry is disposed.
