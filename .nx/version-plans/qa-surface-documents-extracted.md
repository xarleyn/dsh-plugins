---
"@yadsh/dsh-qa-surface": minor
---

Move the document pipeline into its own plugin.

The document subsystem — the five `document_*` tools, their backends,
artifact store, templates, limits and retention sweep — now lives in
`@yadsh/dsh-documents`. It was never QA-specific: it resolves the calling
session's working directory and registers plain agent tools, so extracting it
makes the capability available to any composition and takes roughly a third of
this plugin's host source, its configuration section and its settings-card
section with it.

What a QA chat sees is unchanged: the tool names are identical and become
visible through the same `lockdown.toolPolicy.allow` entries, and artifacts stay
where they were (`<session workspace>/.qa/artifacts/documents/<id>`). What
changes is where the pipeline is configured: `qa-surface.documents` is gone,
replaced by the `documents` namespace of the new plugin and its own card, and the
`QA_DOCUMENTS_*`/`QA_DOCLING_*`/`QA_PANDOC_*`/`QA_LIBREOFFICE_*`/`QA_MARKITDOWN_*`
environment variables became `DSH_DOCUMENTS_*`.

A deployment that still carries the old section is told so: the plugin logs
`documents.moved` on each configuration change, naming the new plugin, so a
leftover cannot silently take the Docling endpoint or the artifact root with it.
The bundled settings card drops its «Документы» section, and the deployment must
install `@yadsh/dsh-documents` wherever the allow-list names those tools —
otherwise the names are missing from the session catalog and attestation fails
closed, which is the existing behaviour for any allow-list entry without a
matching tool.
