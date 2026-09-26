---
"@yadsh/dsh-web-fetch-authenticated": patch
---

The card keeps editing the live profile, now through the host's own mechanism.

Under `0.1.5` this plugin installed its own settings namespace from the host
half and pushed committed edits back into the running provider. `0.1.7` removed
that installation, and with it the slot the card was mounted into. What replaces
both is a marker on the schema: a field belongs to a live form while its node
carries `.volatile()`, and the namespace of such a profile is the profile entry
id. The six nodes the card edits — `enabled`, `rules`, `defaultPolicy`, `limits`,
`documents`, `audit` — now carry that marker, and only at the top level, because
the host rejects a live node nested inside a rule. The namespace stays
`web-fetch-authenticated`, which is the id `cordis.patch.yml` already declares, so
a policy written for the previous build is still read by this one.

The card moved to a tab of its own under Settings → Plugins, and keeps drawing
its own shell. Reading changed shape on the host side: the profile arrives as
stable references, so the provider takes one snapshot per operation instead of
cloning the entry config once at startup — a clone would have made the values it
logged permanent. Nothing about what an operator can change moved: the same rule
list, the same limits, the same write-only credential control, and an edit still
reaches the next request without a restart.

One log line moved. `auth_fetch.config_errors` used to be re-emitted on every
committed edit, because that was the only moment the plugin learned of one; it is
now emitted once, at startup. The card's Provider section has always listed the
same reasons live, and still does, so an invalid rule is reported where it is
edited rather than only in the log.
