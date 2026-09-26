---
"@yadsh/dsh-doc-impact": patch
---

The settings card edits a 0.1.7-rc.2 host's live configuration, and its reminders name their own producer.

The host rewrote its settings subsystem under this release: a namespace is no
longer a section a plugin installs but the profile entry id the loader already
gave the plugin, and a field is editable without a remount exactly when its
schema node is marked volatile. The plugin therefore declares its `Config` — the
same nested document a profile patch row already carried (SPEC §37), so an
operator's existing profile lines are untouched — with every card field on a
volatile node, and reads one plain snapshot per operation instead of merging an
entry config under an installed section. A change saved in the card now moves the
running behaviour directly: the reminder text, the strictness mode, the steering
switch, without the second document the old registration kept.

The namespace an operator edits is the entry id `dsh-doc-impact` rather than the
`doc-impact` label the deleted settings section carried, so values saved through
the old card do not migrate; the profile patch remains the base they fall back to.

The card was registered into `settings.plugin.item`, and that slot no longer
exists. Following the owner's decision on the card shell (D1, option 2), it is a
tab of the Settings → Plugins page now, where it keeps the shared card shell and
edits the same document through the host's configuration form — a field is
addressed by where it stands in the document (`defaults.mode`,
`changeDetection.maxSnapshotFiles`), written with the revision read at the moment
of the write, so a stale view cannot overwrite a newer one. Clearing a field
still re-inherits the composition layer instead of freezing today's value, and a
read-only browser still gets disabled controls plus the notice that says why.

The steered reminder message was attributed to a catch-all `plugin` source kind
that rc.2 does not define, which was the package's one compile error. The plugin
now declares `doc-impact` as its own producer kind and keeps the `notice` form it
already used, so the row in the transcript reads as before.

`Session.snapshotEvents` reads are kept: the host marks them deprecated without a
replacement for a fold over the whole event log, which is what resolving the
current turn is (see the migration map, §5).
