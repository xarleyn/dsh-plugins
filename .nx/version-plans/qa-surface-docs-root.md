---
"@yadsh/dsh-qa-surface": patch
---

The documentation readers reach a corpus that is not inside every chat.

`docs_search` and `docs_read` resolved `<calling chat's cwd>/docs` and nothing
else. In a deployment with per-user workspaces that cwd is the account's own
directory, so the corpus published once — the stand's `/workspace/docs` — was
outside the tree the tools looked in, and every chat and every expert got "this
chat's workspace has no docs/ directory" from a tool that was working exactly as
written. The file tools reached the same corpus all along, by absolute path,
which is why the personas name it; the readers had no way to be pointed at it.

`tools.docsRoot` names that root. Empty keeps the per-chat layout unchanged;
an absolute path makes the documentation tree the configured one, with the
same reporting (`docs/<module>/<version>/…`), the same canonicalization and the
same fence: a root that is missing, not absolute, a file or a link is refused
with a message that names it, and a path that leaves the tree through a
symbolic link is refused as before. The tool descriptions say which of the two
layouts is in force, so the model is told where the documentation is rather than
left to guess.
