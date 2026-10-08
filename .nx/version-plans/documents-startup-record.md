---
"@yadsh/dsh-documents": patch
---

The documents row names the programs it checks, and the Typst mode says whether
the engine is there.

The parsers section of the card sends an operator to the journal when a parse
comes back empty, but the only startup entry the package wrote —
`documents.installed` — named the tools, the storage root, the templates and the
Docling address, and said nothing about pandoc, LibreOffice, markitdown or
Typst. A boot on a machine without one of them logged no warning at all, so the
sentence pointed at a check nobody ran. The entry now carries the outcome of a
startup probe over those four programs and repeats the absent ones as
`documents.programs.missing`, which an ERROR-and-WARN pass over the container's
log answers. The card names the entry by the very key the Host writes, and a
test pins the sentence to the list the probe reports, so the promise and the log
cannot come apart again.

Choosing the Typst PDF mode was a guess: the label warned that the route needs
an engine, and nothing on the page or in the log said whether this deployment
has one. The pipeline section now reads the field the runtime itself refuses on
and states the engine's presence, so the outcome of the choice is known before
a document errors out.
