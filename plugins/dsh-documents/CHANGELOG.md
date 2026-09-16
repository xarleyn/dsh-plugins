## 0.1.0 (2026-09-16)

### 🚀 Features

- Initial release: the document pipeline as its own plugin. ([e10d8fe](https://github.com/xarleyn/dsh-plugins/commit/e10d8fe))

  `document_create`, `document_to_markdown`, `document_from_url`,
  `document_convert` and `document_inspect` move out of `dsh-qa-surface` into a
  service plugin that owns the `documents` settings namespace, the backends, the
  artifact store, the template registry and the retention sweep. The pipeline was
  never QA-specific — it resolves the calling session's working directory and
  registers plain agent tools — so it is now installable and configurable on its
  own, with an operator card of its own and no Remote service.

  Tool names and the artifact layout (`<session workspace>/.qa/artifacts/documents/<id>`)
  are deliberately unchanged, so an existing allow-list and existing artifacts keep
  working. Configuration does move: the section leaves the `qa-surface` namespace
  for this plugin's `documents` namespace, edited in its own card, and the
  `QA_DOCUMENTS_*`, `QA_DOCLING_*`, `QA_PANDOC_*`, `QA_LIBREOFFICE_*` and
  `QA_MARKITDOWN_*` environment variables become `DSH_DOCUMENTS_*`. A leftover
  `documents:` section under `qa-surface` is ignored, and that plugin logs
  `documents.moved` on each configuration change so the leftover cannot silently
  take the Docling endpoint with it.

  `document_from_url` keeps its behaviour from the previous release, including the
  rule that it opens no socket of its own: retrieval goes through the harness web
  seam, so the deployment's fetch rules, credentials, address policy and byte caps
  decide what may be read. The bundle's manifest names the operation and the
  source file; `documents.limits.maxMarkdownChars` bounds what is stored and
  `documents.extraction.maxInlineChars` what is returned inline.

### ❤️ Thank You

- xarleyn @xarleyn