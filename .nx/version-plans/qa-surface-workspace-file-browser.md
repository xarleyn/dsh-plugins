---
"@yadsh/dsh-qa-surface": minor
---

The files rail browses the chat's own working directory and opens what it finds.

The panel could already list what a visitor attached and reopen the files an
answer cited as sources, but everything the conversation *produced* — the
document a `document_create` call wrote, the notes an agent left behind, the
manifest beside an artifact — stayed invisible: the rail said "there are no
attachments in this chat", and the only way to reach those files was a shell on
the host. Two new Host methods close that gap (`listWorkspaceFiles`,
`readWorkspaceFile`), and the «Файлы» tab renders them as a directory browser:
crumbs from the chat's root, one directory at a time, folders first.

Browsing is deliberately narrower than the source preview it sits beside. The
listing is confined to the attested chat's own directory — the realpath- and
containment-checked request refuses everything else with the shared
`outside-roots` reason, symlinked children are omitted rather than followed,
and the single listing cap (`sources.filePreview.maxListingEntries`, default
500) reports the cut instead of hiding it. Reading reuses the source preview's
root policy unchanged — the chat's cwd, the deployment's shared read-only
roots, and the attachment store — so a file the model itself may read stays
readable in the panel, and nothing else does. Unlike the source preview it does
not require the file to be recorded evidence, because the visitor is browsing a
tree rather than reopening a cited source; the switch that opens file reading
at all (`sources.filePreview.enabled`) governs both and is now also rendered
with the new cap in the settings card.

A text file opens inline — Markdown with the same rendered/raw toggle the
source detail uses, anything else as monospaced text — while a binary file
reports that it does not read as text and offers the whole file as a download.
The download happens in the page: the bytes arrive base64 in the read answer and
become an object URL, so no unfenced byte-serving route is exposed to the
audience.

Word documents are previewed rather than described: the panel asks the Host for
a renderable copy (`previewWorkspaceDocument`), which converts the file through
the document pipeline's own runtime — the service `@yadsh/dsh-documents`
publishes for its host siblings — and hands back the produced PDF, drawn by the
browser's viewer inside a blob frame. A deployment without that pipeline, a
format it cannot render, or a conversion that fails all end in the same honest
sentence and a working download, never in a guess. PDFs already in the
workspace preview the same way from their own bytes. Any open file — text,
image, PDF — can be expanded out of the rail into a dialog-sized view
(`Развернуть файл`), which shows the same body with more room and closes back to
the directory.
