---
"@yadsh/dsh-documents": patch
---

Name the document retention effect after the plugin that owns it.

The document pipeline began life inside QA Surface, and one leftover from that
move survived in the logs: the retention sweep's Cordis effect was registered
as `dsh-qa-surface.documents-retention`, so a Host operator reading the log
saw the document retention teardown attributed to a plugin that no longer owns
it. The effect id is now `dsh-documents.documents-retention`, matching the
plugin's other effect ids and its settings namespace. Nothing changes at
runtime — the id is a log/teardown label, and the sweep itself is untouched.
