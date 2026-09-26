---
"@yadsh/dsh-qa-surface": patch
---

The sources panel, the files panel and the markdown renderer now name every part
of themselves, so a test can point at the node it means instead of guessing it
from the Russian caption beside it or the BEM class under it.

Every control those files draw, and every node whose state the sheet carries as
a class modifier, takes a `data-testid`: `qa-sources-*` for the grouped list,
`qa-source-detail-*`
and `qa-source-preview-*` for the detail view and its file preview,
`qa-source-badges*` for the origin badges the list and the detail share,
`qa-files-*` for the attachment roster, `qa-md-*` for the rendered document, and
`qa-source-chip-*` for the source faces the markdown shares with
the panel. A group heading stays unnamed — its caption is the handle a run reads
— while the count and the time beside it take one.
A group takes the id of the kind key it already declares
(`qa-sources-group-web`, `qa-sources-group-file`), so a new kind inherits its hook
rather than naming one, and a state the class carried as a modifier carries the
same fact in the id — `qa-source-preview-line-highlight`, `qa-md-math-pending`,
`qa-files-thumb-broken`. Two notices carry an id of their own — the truncated
file preview and the Mermaid parser warning — so the checks that a broken
diagram must not take the answer down with it name the notice instead of
matching its sentence. The values are ASCII kebab-case, zoned by prefix, and
no two of them name different things in the package.

The panel and renderer tests now reach those nodes through the ids instead of
`querySelector(".dsh-qa-*")` or `getByText`, and what a test asserts about a
caption or a control — the group titles, the Raw/Rendered toggle, the
jump-to-message button, a diagram's expanded state — it still asserts through
role, accessible name, or the control's own ARIA state. No markup and no
appearance changed: an attribute was added.
