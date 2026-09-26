---
"@yadsh/dsh-ui-repair": patch
---

The card reads its settings the way a 0.1.7-rc.2 host serves them, and is found again.

Under `0.1.5` the browser half edited a settings namespace the host half had
installed itself, so the namespace was a name this package invented. `0.1.7`
removed that installation: a field is editable while its schema node is marked
live, and the namespace of such a profile is the profile entry id. Every field of
UI Repair is editable, so all eight now carry `.volatile()`, and the namespace is
`dsh-ui-repair` — the id `cordis.patch.yml` already declares. A policy written
under the old `ui-repair` section is therefore not read by this build, and the card
mounts as its own tab of the Plugins settings section, keeping the card shell this
package draws for itself.

Reading changed too. A live field is a reference, so the host companion takes one
snapshot per operation instead of cloning the profile once at entry — a clone made
the values it logged permanent, which is how the entry-time log and the card's own
policy could disagree. The companion now logs readiness from a snapshot and stops
logging changes: the signal it used to hook was the installation's callback, and
the live path runs through the card, which already re-applies every policy field as
the form reports it.

The repair scanner lost one place to look. It had treated the children of the old
card slot as plugin surfaces to diagnose, and `0.1.7` emits no marker for that slot
because the slot is gone; the cards it meant are now found through the shell class
the repository's own card contract pins them on. Surfaces that carry an explicit
`data-dsh-ui-repair-root` or a plugin attribute are discovered exactly as before,
and the card still excludes its own body from every scan.
