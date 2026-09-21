---
"@yadsh/dsh-documents": minor
---

Repeat conversions reuse the recorded result instead of running the backend again.

The pipeline kept no memory of what it had already converted: every
`document_convert` and `document_to_markdown` call allocated a fresh artifact and
ran Docling or LibreOffice from scratch, even when the same file had just been
processed with the same options. Extraction is the slowest step in the pipeline,
so the repeat was pure waiting.

Conversions now record what they produced under `<artifact root>/.cache/`, keyed
by the input's SHA-256, the options that shape the request, a fingerprint of the
pipeline settings, and the identity and version of the backend that would run.
A hit copies the recorded file into a fresh bundle — verified against the hash
the entry stored — and writes an ordinary manifest that names the bundle the
bytes came from in a new `cache` record, so a caller cannot tell a hit from a run
except by the provenance line. A missing artifact, a tampered file or an
unreadable entry is a miss, and the backend runs again.

The new `documents.cache` settings section turns the cache off, bounds it by
entries, bytes and age, and defaults to on with a one-gigabyte budget.
