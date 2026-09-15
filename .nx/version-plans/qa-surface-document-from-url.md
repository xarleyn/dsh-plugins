---
"@yadsh/dsh-qa-surface": minor
---

Add `document_from_url`: an online source stored as a document artifact.

The pipeline could already turn Markdown into DOCX/PDF and read a DOCX/PDF back
out of the workspace, but nothing could take a document that lives behind a URL —
a wiki attachment, a text document served by an authenticated provider — and put
it where the other tools work. The new tool fetches the URL through the
deployment's web provider, so the fetch rules, credentials, address policy and
byte/char caps configured there decide what may be read; the plugin opens no
socket of its own, and without a web provider the tool answers
`BACKEND_UNAVAILABLE` instead of guessing. A text response is written into an
artifact bundle whose manifest names the operation and the source file, and the
payload is bounded on both sides: `documents.limits.maxMarkdownChars` for what is
stored, `documents.extraction.maxInlineChars` for what is returned inline. An
HTML response is refused with `UNSUPPORTED_FORMAT` (pages are read by the web
fetch tool), and the fetch layer's own refusal — "the .pdf format is not
extracted", "no rule matches", a timeout — reaches the model unchanged rather
than being flattened into a generic failure.
