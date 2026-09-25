---
"@yadsh/dsh-qa-surface": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-web-fetch-authenticated": patch
---

The QA changelog names what #286 actually shipped, and the guards #286 added
gain the regression tests that hold them.

Version 0.13.0 described three of its own capabilities — the one-request
`/no-review` waiver, the automatic managed service profile for a new account,
and `web_fetch_file` for non-graphic attachments — nowhere, although the plan
that released them named all three; the curated list now carries them.

Documentation search pins the grep syntax it promises the model (character
classes and anchors) and its pattern budget, and `docs_read` refuses an
absolute path that leaves the documentation tree the way `docs_search` already
did. Automatic service binding is tested against both of the shapes it has to
stand down for: a deployment that offers no default profile, and one that
publishes several. Downloaded attachments test their leaf-only filename
directly, so a percent-encoded path cannot reach the store with separators.
