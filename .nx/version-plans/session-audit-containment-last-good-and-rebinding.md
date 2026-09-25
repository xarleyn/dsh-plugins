---
"@yadsh/dsh-session-audit": patch
---

Three fixes to how the audit reader trusts what it finds on disk.

An audit directory swapped for a link is no longer read through. Containment was
a comparison of two path strings plus one `lstat` of the artefact, so replacing a
registered audit directory with a symlink or a Windows junction sent the next
read to whatever a neighbour kept under the same name — a report the session was
shown that its own audit root never held. Every step from the audit root down is
now walked and no link is followed, and the bytes handed back are the ones the
opened handle was proved to be, matched against that walk by file identity rather
than by name.

A last-good audit stays readable, not merely summarised. When a producer left an
`analysis.json` truncated, the summary of the last valid version survived while
the detail view went back to the broken file and returned nothing, so the session
offered an Audit tab with nothing in it. The bytes a record was registered from
are now held with it: the report, the structured findings and the raw document
stay the version the summary describes, and a replacement that validates still
takes the view over.

An audit waits for its session only as long as the session list says it should.
A binding decided by the directory name — or by a session id the harness would
spell with its own prefix — was settled once and cached together with the
artefact's content, so a session created later never collected its audit: the
record stayed `unresolved` while its bytes sat unchanged. The binding keeps its
own state now. A session list that grew re-opens the bindings it left unfinished
— an audit no session claimed, or one whose id is missing the prefix the harness
would spell it with — a list that did not change costs no read, and an audit
already bound the way the harness spells its ids is never looked at again.
