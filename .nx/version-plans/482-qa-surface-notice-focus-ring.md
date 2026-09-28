---
"@yadsh/dsh-qa-surface": patch
---

The keyboard reaches the turn notices, and keeps its place when one goes away.

The notice stack is painted in `document.body`, outside the `<main>` whose key
handler holds Tab inside the QA interface, so the ring was drawn around a subtree
the notices were not part of: a Tab leaving the composer turned back at the
surface's last control, and `open`, the line's cross and the desktop opt-in
could not be reached without a mouse. The ring now walks the surface and the
stack together, and a key typed inside the portal is trapped by a handler mounted
on the portal itself — `<main>` is not its ancestor and never hears it. Only Tab
is taken there, so an Escape given inside the stack still reaches a dialog that
listens on the window. And while a modal dialog holds the keyboard — the
onboarding gate marking the page inert, or a `QaModal` standing over it — the
ring steps back to the surface alone: the stack is a neighbour of such a dialog
rather than its content, so a trap closed around both would take the reader out
of the dialog they are working in and back onto a page under the scrim.

Losing the focused control is read where it happens rather than from the number
of lines. Waving one of the three off, a fourth turn pushing the oldest out of a
full stack, and the opt-in going away once the browser has answered the
permission question all take the focused button out of the page while the stack
stays on screen; the page then answers the next Tab with the browser's own order,
which leaves the interface. The ring remembers the line the reader stood on and
hands the keyboard to the line that took its place, on the same control of it —
a cross given back as a cross. A stack control alone is remembered: a row of the
chat list, the queue dock, or a transcript action that leaves the page under
focus is the surface's own business, as it was before. And the remembered place
goes only with the focus it hands back — a reader who moved the keyboard
elsewhere, by mouse or into another dialog, is not pulled back, and a dialog that
owns the keyboard is left to place the focus where it belongs.
