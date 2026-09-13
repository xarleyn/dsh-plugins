---
"@yadsh/dsh-qa-surface": minor
---

Open the "История версий" dialog at the wide panel width the profile dialog
already uses. Its entries are full sentences, so the shared 560px panel
stranded a word or two on every second line; the 720px panel leaves them on
one line and keeps the two dialogs the same size, which is what a reader
opening one after the other expects.

The panel width stays a property of the dialog and not a preference: neither
dialog is resizable, so there is no width for the browser or the deployment to
persist and no bounds to keep in sync with the viewport. Both keep the
`max-height` cap and scroll their body on a short window.
