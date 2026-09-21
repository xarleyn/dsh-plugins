---
"@yadsh/dsh-qa-surface": minor
---

A QA chat can read the stand's documentation on purpose instead of guessing at it.

Documentation was never a surface of its own: a reviewer would cite a path in
the chat's own `docs/` tree and the model had no tool that said where that tree
is, so it swept the workspace with globs, asked memory instead, and read a miss
as "the document does not exist" rather than "wrong tree". The catalog now
ships `docs_search` and `docs_read` (catalog version 3), both read-only and
both pointing at `<chat workspace>/docs`.

`docs_search` matches a phrase inside single lines and reports every hit with
its path, its line number and the module and version parsed out of the layout
`docs/<module>/<version>/…`; `version`, `module` and `path` narrow a search to
one edition, one module or one subtree, so a chat that was told "3.8" stops
sweeping every edition. `docs_read` opens one file at a bounded window of
lines, and both tools bound what they return — `limit` and a byte budget on the
reported hits, a line budget on a read — and say so when they truncate, which
keeps a "right search" from answering with a wall of text.

The fence is the same one the rest of the plugin uses. Only files inside the
documentation tree are read; a path outside it, a path that leaves it through a
symbolic link, a directory handed to a read, a binary file and a workspace
whose `docs/` is missing, a file or a link are refused with an explicit reason
that names neither an absolute host path nor anything outside the tree. Files
the walk merely meets and cannot read are skipped rather than failing the
search, and an explicitly named path still gets the honest refusal.

The tool descriptions do the routing the catalog exists for: they state that
documentation lives in `docs/` and is looked up with these tools rather than
from memory, so the instruction travels with the schema the model is actually
given.
