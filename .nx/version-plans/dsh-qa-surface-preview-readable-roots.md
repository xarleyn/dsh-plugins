---
"@yadsh/dsh-qa-surface": patch
---

Open the source preview over the roots the QA read policy already grants. The
endpoint validated a source against the session's `cwd` alone, so a file the
assistant had legitimately read from a shared read-only directory — the normal
shape of a deployment that keeps `docs` and `code` beside the per-account
scratch directory — was refused as an escape and the panel reported it as
moved. The preview now reads the chat's `cwd`, every
`lockdown.sharedReadOnlyRoots` entry and the mounted attachment store, mirroring
the per-user execution guard, and it canonicalizes the requested path the same
way the evidence bundle did, so the browser's spelling of a file (its
projection uses the configured `session.cwd`, which is null for a chat pinned by
`workspaceId` or by an account directory) no longer decides whether a preview
opens. Refusals carry a coarse `(reason: <code>)` marker and the panel says
which directory group a file falls outside instead of calling every refusal a
moved file.
