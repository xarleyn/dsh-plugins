---
"@yadsh/dsh-qa-surface": minor
---

The chat-history sidebar gained a footer version button that opens an
end-user changelog dialog: a curated per-version summary (new features and
fixes in Russian) rendered in a themed modal with Escape/backdrop close.
The bundled version and entries are pinned to package.json and the release
CHANGELOG by a unit test, so a release cannot ship a stale dialog.
