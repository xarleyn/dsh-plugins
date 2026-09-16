---
"@yadsh/dsh-qa-surface": patch
---

Harden the Host side of the QA surface against malformed and foreign input
found in the host audit.

The administrative role write now re-validates the role union before it
stores anything: `adminUpdateUser` accepted an arbitrary string from the
wire, and a role outside `user`/`reviewer`/`admin` was persisted as-is,
crashing every later permission check for that account with a `TypeError`.
The accounts, quality, capability-policy and provenance files are created
owner-only (`0o600` on POSIX, where the atomic rename keeps the mode;
Windows ignores the mode and keeps its own ACLs), matching the `0o700`
directories the plugin already used for per-user workspaces.

Delegated subagent sessions are no longer attestable from the browser: they
have no QA owner and their sources reach the parent chat through the
dedicated inheritance flow, so pinning a capability policy onto one only
created an unreviewable conversation. The first-come auto-claim of unowned
sessions in `ensureSessionAccess` is bounded the same way: a session the
Host knows to be a delegated child is refused outright, and one older than
the fresh-session bootstrap window (120 s, the same constant the admission
boundary uses for adoption) is refused instead of being silently attached
to whoever opened it first. Owners re-attaching after a Host restart are
unaffected — their claim already exists in the accounts file.

`qa-sources.json` stopped growing without bound. A session's snapshots are
now dropped from the durable file when the session is disposed (previously
only the in-memory maps were cleared), and backstop caps — 256 sessions,
500 turns per session, oldest first — bound the file for sessions that
never dispose cleanly. The store keeps an mtime+size stamp of the file, so
a turn no longer re-reads and re-parses the whole JSON it just wrote.

Two small reliability fixes ride along: the question gate folds a malformed
answer payload (a non-array, a non-object entry, a non-string selection)
into its existing refusal/skip semantics instead of throwing, and the
admin ownership listing re-reads the accounts file when another process
changed it, like every other read in the store.
