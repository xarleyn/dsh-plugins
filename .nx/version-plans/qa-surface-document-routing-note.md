---
"@yadsh/dsh-qa-surface": patch
---

The prompt gains a note that sends an attached office document to the document
pipeline instead of the plain file reader.

A chat user's `.docx` arrives as a path into the attachment store, and a run
that reads it with the plain file reader gets `cannot read "…docx": binary
file`. That answer is a fact about the format, not about the file being absent,
but nothing said so: in the session this comes from the agent read the refusal
as "the file isn't in the workspace", went looking for the document it had
already been handed, and opened the next turn by announcing that it could not
reach the file at all. The pipeline it should have used — `document_inspect`,
`document_to_markdown`, and `document_from_url` for an attachment that only
exists behind a URL — was available the whole time.

`notes.documents` is that rule in the deployment's own words, on by default
beside the other notes, muteable and rewordable from the «Заметки модели»
section of the settings card, and delivered on the same gate as the provenance
and delegation notes. It says which reader a DOCX or PDF belongs to, that the
plain reader's refusal for those formats is expected rather than a hint to
search elsewhere, and that a refusal from the pipeline itself is a report to
make — with the path it named — rather than a reason to try a third reader.

This is the last third of the routing the QA stand was missing: it is the only
note whose subject is another plugin's tools, so a deployment with no document
pipeline can mute it, and the note is advisory like every other — the
lockdown, the tool allow-list and the sandbox hold whatever the conversation
says.
