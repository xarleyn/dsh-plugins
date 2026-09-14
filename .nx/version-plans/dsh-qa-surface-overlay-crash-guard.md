---
"@yadsh/dsh-qa-surface": patch
---

A crash inside the QA surface no longer uncovers the operator harness.

The QA overlay is a `shell.overlay` slot entry, and the host's per-slot
isolation retires an entry that throws during render: the cell falls through
to its (empty) crash face, the overlay disappears, and the harness shell it
exists to cover — settings, native sessions, everything the deployment means
to keep away from QA visitors — becomes reachable on the same page. One
render-time `TypeError` anywhere in the surface tree was enough.

The registered entry is now its own error boundary (`QaSurfaceGuard`) that
the host never sees past: a crash swaps the surface for a fullscreen failure
card in the same opaque overlay class, with a reload button as the recovery,
and logs the error for the operator console. The slot inject joins the same
contract — its lazy host-service reads degrade to an empty face instead of
throwing, which lands in the guard as the same failure card rather than an
abdicated entry.

The same trade existed without any crash: the overlay only *covered* the
harness, which stayed mounted and fully alive beneath it, so deleting the
overlay element in the browser revealed the operator shell on the same page.
While the surface owns the route, a stylesheet rule now masks every sibling
of the host's overlay layer inside the app frame — hanging off the
`data-dsh-qa-surface` body attribute rather than off the overlay node, so
element deletion changes nothing. The attribute is owned by the guard, above
the error boundary (a crash unmounts the surface, not the mask), and a face
that fails to assemble keeps the page masked as well; off-route the mask
lifts and the host shell is the page again.

A reload on the QA route also flashed the harness for a moment, because the
harness mounts and paints before the plugin's client bundle registers the
overlay. On proxy-fronted deployments the proxy now injects a boot mask into
the served HTML: on `/qa` navigations the body stays hidden from the first
paint, and the guard lifts it in the same synchronous block that takes the
page over (`data-dsh-qa-boot="done"`), with a fail-open timeout so a
deployment whose plugin never loads still reaches the harness.


