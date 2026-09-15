---
"@yadsh/dsh-web-fetch-authenticated": minor
---

Serve Confluence attachments as links, and read Word/OpenDocument attachments
as text.

A storage body names an attachment by filename and nothing else, so a page that
says "see the attached regulation" used to reach the model as a bare name it
could do nothing with. The Confluence adapter now resolves every attachment
reference — a linked file, an embedded image, and the embedded Office/PDF viewer
macros (`view-file`, `viewpdf`, `viewdoc`, `viewppt`, `viewxls`) — into its
download URL, and appends the page's own attachment collection as an
`## Attachments` list with name, media type, size and link. `adapter.cleanup:
strict` still serves neither, and `adapter.maxAttachments` (default 50, `0`
disables the list) caps how many entries one page reports; a failed collection
request never costs the page.

Downloading an attachment as bytes is impossible by construction: the harness
body union is `html | text`, so the plugin extracts the document's text inside
the provider and returns that. Word (`.docx`/`.docm`/`.dotx`) and OpenDocument
(`.odt`) files are inflated in memory — no external binary, no temporary file —
and rendered as Markdown with headings, paragraphs, list items and tables; field
codes, deleted revisions, comments, drawings and footnotes are left out. The
per-rule `documents` section bounds it: `maxBytes` (default 4 MiB) caps the
download, `maxChars` (default 40000) caps what a document may add to the
conversation, and both are overridable from the top-level `documents` defaults.
A format the plugin does not read (PDF, legacy `.doc`, spreadsheets,
presentations, archives) is refused by name instead of as an unknown content
type, and bytes that only claim to be a document are refused too rather than
returned as mojibake. `documents.enabled: false` restores the previous behavior
exactly, and the connection tester runs the same extraction so Test on an
attachment URL shows what the model would receive.
