---
"@yadsh/dsh-qa-surface": patch
---

An answer that carries LaTeX or a table no longer shows its markup while it is
being written.

A research question costs minutes on this stand, and the answer arrives as a
stream: the browser renders every frame of the text grown so far. The block
parser read those frames the way it reads a finished answer, where a `$$` fence
with no closer is a paragraph — so while the model was still inside a formula
the reader saw its dollars and a half-typed `\frac{`, a table showed its own
pipes until the delimiter row was typed whole, and the row being typed rendered
as a truncated one. A Mermaid diagram made it worse: an open fence was handed to
`mermaid.render` on every frame, which answered with a syntax error and then
with the error panel next to the code.

The parser stays the single authority on where a block ends. It learns exactly
one fact from the caller — the text is a live frame — and reports the block the
stream stopped inside as `pending`, so no component re-detects an unfinished
tail. An open block is then held rather than guessed at: the TeX shows as a
monospace frame carrying what has been written, without its delimiters, a
half-written delimiter row opens the table header, a row still being typed stays
out of the cells, and an open Mermaid fence stays source.

A settled answer is untouched, which is the invariant the tests hold: every
block the stream leaves open reads exactly as it did before once the text has
settled, because without the flag nothing about the grammar changes.
