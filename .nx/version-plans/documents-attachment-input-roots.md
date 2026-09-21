---
"@yadsh/dsh-documents": minor
"@yadsh/dsh-qa-surface": patch
---

An attached document becomes readable input for the document pipeline (#174).

The QA read fence has exactly one deliberate exemption: a single-file read of
the mounted attachment store, which sits outside every workspace by design and
whose stored path the prompt hands the model. The document pipeline keeps its
own read scope — session workspace, artifact root, and the roots configuration
names — and knew nothing about that store, so `document_inspect`,
`document_to_markdown` and `document_convert` refused the very file the model
had just been allowed to read, and the files panel's Word preview hit the same
wall. Naming the store in `documents.storage.allowedInputRoots` would have
closed the gap by configuration alone, at the price of two settings that must
stay in sync and a fence nobody owns.

The scope now carries the roots a *caller* grants for one call:
`DocumentScope.extraInputRoots` is canonicalized like every other root and
appended to `allowedInputRoots`, so it adds readable roots without touching the
artifact root writes go through. The published `documents` face gains
`registerInputRoots(sessionId, roots)` for the plugin that owns a session's read
fence, and qa-surface uses it: the admission that installs the per-user
workspace fence grants the attachment root for the session it just attested, a
delegated child inherits the grant the way it inherits the fence, and
`agent/disposed` plus `dispose()` revoke it. The files panel passes the same
root inline on the conversion it starts, because its own read policy is what
accepted the file.

A grant stays as narrow as the exemption it mirrors: resolution still reads
exactly one named file, so a shared store can never be walked, and symlinks that
leave a granted root, directories, and paths outside every root are refused
exactly as before.
