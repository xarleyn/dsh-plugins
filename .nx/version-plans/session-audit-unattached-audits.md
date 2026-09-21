---
"@yadsh/dsh-session-audit": minor
---

An audit that belongs to no session is now reported instead of disappearing.

Copying an audit into the audit root and seeing nothing anywhere was the whole
failure mode: an artefact no session claims (`unresolved`) and a directory that
is not a readable audit (`invalid`) are both held by the registry and both shown
in no session, so the only way to tell "the audit never arrived" from "the
registry is holding it" was to read the host log.

The registry gains `unattached()`, the service exposes it as the `unattached`
remote, and the Audit view lists what it returns above its empty state — the
directory name and one sentence naming the reason. Beside a session's own audit
the same notice still appears, because the question it answers is about the
audit root rather than about the session being read.

The wire carries the diagnostic's stable code and never its message: those
messages quote the artifact's path, and the browser is told why an audit is not
attached and never where it sits. A code this build does not know degrades to a
sentence that is still true rather than to an empty list.
