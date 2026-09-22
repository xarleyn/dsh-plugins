---
"@yadsh/dsh-qa-surface": minor
---

Documentation search answers from the corpus's documents, and a stand can name
the edition it is about.

A published corpus carries its own working material beside its documents — the
asset tree, the inventories, the triage notes — under leading underscores, and
`docs_search` read that material first: `_` sorts before letters, so an
inventory that names every module and version the corpus has answered the
question and spent the hit budget before a document was opened. On the stand's
own tree a path-less search reported no matches at all for a term 24 documents
contain, because the walk counted its way through thousands of images first and
stopped. The walk now visits documented modules before loose files and the
corpus's own material last, decides the queue by path rather than by when a
directory was met, recognises media, archives and office binaries by extension
without reading them, and counts neither them nor out-of-scope files against
its document budget. A search that finds nothing now says so having read the
corpus.

The two facets a filtered search answers under — `version` and `module` — were
returned at the root of the result but were not declared in the tool's output
schema, and the registry refuses an undeclared property: every call that used
the filters failed with "returned invalid output" after doing the work, which is
exactly the call the facets exist for. Both are declared now.

`tools.docsDefaultVersion` and `tools.docsDefaultVersionEnabled` name one
edition as the stand's: a search that named neither `version` nor `path` stays
inside it, the answer says the stand narrowed it rather than the model, and a
call that asked for another edition or another subtree still decides for itself.
The settings card gains a "Документация" section with the switch, the version
and the effective corpus root, so an operator sees which edition the stand's
answers come from and where the corpus actually is.
