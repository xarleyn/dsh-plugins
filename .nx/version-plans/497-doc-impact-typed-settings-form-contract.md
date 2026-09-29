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
reaching the Host.

Two readings of the Host document became honest readings. The document is raw
profile JSON, and the field specs only describe its shape: where a field promises
a scalar and the layer holds an object or an array instead, the card now shows the
default the field would fall back to rather than carrying that node into the
field's value (an unchecked cast used to do the latter). And the Host hands out a
settings form for any name asked of it, served or not, so the card asks the service
that knows instead: the tab is claimed only while the namespace is served, where
before it was claimed unconditionally and an unserved namespace left an empty tab
on the Plugins page.

What the card writes is unchanged. Drafts still never write before Save, Save
still commits field-granular path operations in staging order, a save that did not
land keeps its drafts, and a reset still drops the user layer instead of copying
the composition base into it — that last one is now pinned for every kind of
field, and the defaults and vocabularies the card repeats are pinned against the
plugin's own configuration schema.
