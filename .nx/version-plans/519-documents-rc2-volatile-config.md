---
"@yadsh/dsh-documents": patch
---

The document pipeline runs live on a 0.1.7-rc.2 host, and its card moves to the surface that host still serves.

The pipeline configured itself through an installed settings section, which the
`0.1.7` settings rewrite deleted: a field is now editable without a remount
exactly when its schema node is marked volatile, and the namespace an operator
edits is the profile entry id rather than a section a plugin installs. Every
section of this plugin's `Config` is therefore volatile now, which is what keeps
all fifteen of them in the form the Host serves; the loader hands each as a
stable reference, so the entry reads one plain snapshot per operation instead of
copying the configuration at startup, and rebuilds the subsystem when a committed
write moves the resolved values. An operator turning the pipeline off stops the
five tools at once, as the card's own hint promises.

The card was registered into `settings.plugin.item`, and that slot no longer
exists. It is a tab of the Plugins settings page now — the surface the README
already described — where it keeps the shared card shell and edits the same
namespace through the Host's configuration form, writing with the revision it
just read so a stale view cannot overwrite a newer one. Clearing a field still
re-inherits the composition default rather than freezing today's value, and a
browser the Host serves read-only still gets disabled controls plus the notice
that says why.
