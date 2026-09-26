---
"@yadsh/dsh-domain-experts": patch
---

The plugin's own configuration is edited live on a 0.1.7-rc.2 host.

It published its knobs through a settings section it had installed itself, and the
`0.1.7` settings rewrite deleted that seam: a field belongs to the form the Host
serves exactly when its schema node carries `.volatile()`, and the settings
document of a profile is keyed by the profile entry id rather than by a name the
plugin invented. All ten knobs are volatile now, which is what keeps them
editable from the browser, and the `domain-experts` namespace goes with the
section that created it — an operator edits the `dsh-domain-experts` entry.

Reading moved with it. A volatile field is a stable reference, so the service
takes one plain snapshot per operation instead of holding the entry it was
composed with, and a value committed after startup is the value the next
operation sees. Turning `enabled` off still withdraws the three agent tools at
once: that is the one knob with an effect beyond the next read, and it is now
re-applied on the loader's volatile-update event rather than on the installation's
callback. `defaultMemoryProvider`, `memoryDbPath` and `auditLimit` keep the
restart caveat their descriptions already state — the provider set and the audit
ring are built once, when the plugin loads.
