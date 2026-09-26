---
"@yadsh/dsh-web-fetch-authenticated": patch
---

Nothing the settings card does changed; what changed is how its source is cut,
and which REST hops now have a test.

`src/client/sections.tsx` was 1632 lines — the one file of this package above
the fail threshold the repository is settling on, and the whole card body in a
single module: the provider overview, the global limits, the rule table, the
editor, the credential control, the tester and the diagnostics view. Each of
those now owns a file under `src/client/sections/`, the largest of them 335
lines, with the controls and the injected client face they share in
`sections/common.tsx` and the draft conversions in `sections/rule-draft.ts`.
`sections.tsx` stayed as the barrel the card imports, so the client entry and
the published contract are untouched and the built bundle still registers
itself under the package's full name.

The adapter's REST hop is now tested on the transport it actually uses. The
seam tests stub the transport and the provider tests walk happy paths, so the
request the adapter builds for itself — the rewritten `/rest/api/...` URL — was
the one hop no test ran through policy: a redirect that leaves the origin is
denied and the credential is never dialed there, a redirect that stays inside
the rule's paths is followed with the rule's own auth, a body larger than the
rule's cap is refused before it is read, an answer that is a login page rather
than JSON fails as an adapter failure instead of a parsed issue, and an
under-reported body that is cut mid-stream is refused rather than half-read.
Everything listens on loopback, so the suite reaches no network.
