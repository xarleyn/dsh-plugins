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

Two of the ways a place is handed over are decided rather than left to chance.
Opening a chat from a line is the one loss that also changes what the surface
shows: the notice goes, its chat arrives, and the keyboard stays on the stack —
the composer the switch remounts is disabled while that chat is being bound, so
it can take no focus, and nothing in the surface moves the keyboard on a switch
further than it already does. And a page the reader has left to work in another
window is left alone: while `document.hasFocus()` is false nothing here touches
the keyboard, because a control of a page nobody is looking at has no claim on
the page the reader is typing in. The hand-over is owed rather than dropped —
the remembered place stands until the window's own `focus` event pays it, so the
reader who comes back to a stack that dropped a line under them finds their place
and their next Tab is the interface's.

What the ring counts as a step is what a browser stops on, read off the markup:
the negative `tabindex` is subtracted from every kind of control, not only from
the elements that carry the attribute, `hidden` is read along the ancestor
chain, a `select` or a `summary` — the role picker of the header and the fold of
a message — is a step of the way, and the body of a fold the reader has not
opened is not. A ring with no controls in it takes no key at all: a Tab
prevented with nowhere to hand the focus is a key that sticks.

The markup is not the whole of what a page hides. The chat rail is switched off
at ≤900px and the sidebar at ≤600px by a media query, which leaves neither a
`hidden` nor a `tabindex` to read, so the enumeration reads the layout too: a
control whose own or whose ancestor's computed `display` is `none` is off the
path, and so the edge of the ring is drawn at a control the reader can actually
stand on. The walk up the ancestor chain is what says it — a control of a
switched-off subtree answers for its own `display` exactly as it does on screen,
which a live Chromium measured on the two production rules. As a last step the
hand-off still asks each candidate to take the keyboard and spends the key on the
next control of the way if it answers by moving nothing, which covers the refusal
no read predicts and the environments that apply no CSS at all.

Both were measured in Chromium with the production sheet and the ring module of
this branch on a fixture shaped like the mounted surface — the sidebar, the
header, a fold, the rail, the composer, and the stack in `document.body` — with
real `Tab` and `Shift+Tab` presses. At 1200px the trail from the composer walks
`send → open → dismiss → opt-in` and turns back at the stack's edge into the
first control of the sidebar. At 500px, where both parts are switched off, the
ring enumerates neither, and Shift+Tab from the header's control — the front the
width leaves — lands on the stack's opt-in; against the ring as it stood at HEAD
the same press leaves the page for the browser's own order, and the walk back from
the composer escapes at that same step. At 850px, with the rail switched off and
no notices on screen, Tab from the composer's send turns back into the interface.
What the stand still owes is the same walk on the mounted surface in a browser:
not run, because the browser panel of the stand is collapsed (`viewport=0x0`) and
gives no real key presses to observe.
