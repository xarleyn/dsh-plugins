## 0.5.0 (2026-09-22)

### 🚀 Features

- An attached document becomes readable input for the document pipeline (#174). ([e86ee49](https://github.com/xarleyn/dsh-plugins/commit/e86ee49))

  The QA read fence has exactly one deliberate exemption: a single-file read of
  the mounted attachment store, which sits outside every workspace by design and
  whose stored path the prompt hands the model. The document pipeline keeps its
  own read scope — session workspace, artifact root, and the roots configuration
  names — and knew nothing about that store, so `document_inspect`,
  `document_to_markdown` and `document_convert` refused the very file the model
  had just been allowed to read, and the files panel's Word preview hit the same
  wall. Naming the store in `documents.storage.allowedInputRoots` would have
  closed the gap by configuration alone, at the price of two settings that must
  stay in sync and a fence nobody owns.

  The scope now carries the roots a *caller* grants for one call:
  `DocumentScope.extraInputRoots` is canonicalized like every other root and
  appended to `allowedInputRoots`, so it adds readable roots without touching the
  artifact root writes go through. The published `documents` face gains
  `registerInputRoots(sessionId, roots)` for the plugin that owns a session's read
  fence, and qa-surface uses it: the admission that installs the per-user
  workspace fence grants the attachment root for the session it just attested, a
  delegated child inherits the grant the way it inherits the fence, and
  `agent/disposed` plus `dispose()` revoke it. The files panel passes the same
  root inline on the conversion it starts, because its own read policy is what
  accepted the file.

  A grant stays as narrow as the exemption it mirrors: resolution still reads
  exactly one named file, so a shared store can never be walked, and symlinks that
  leave a granted root, directories, and paths outside every root are refused
  exactly as before.

- Repeat conversions reuse the recorded result instead of running the backend again. ([56d2532](https://github.com/xarleyn/dsh-plugins/commit/56d2532))

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

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.4.0 (2026-09-21)

### 🚀 Features

- Sibling host plugins can convert and extract through this plugin's pipeline. ([c316658](https://github.com/xarleyn/dsh-plugins/commit/c316658))

  The tools were the only surface: a plugin that needed a document rendered had
  to stand up a second runtime with its own provider registry, semaphores and
  limits, or shell out to the same binaries behind the pipeline's back. `apply()`
  now publishes the installed subsystem as the `documents` service
  (`toMarkdown`, `convert`, `inspect`), and each callback reads the live runtime
  at call time, so a configuration reload that rebuilds the subsystem cannot
  leave a caller holding a disposed one. Nothing new is reachable from a browser —
  the service lives in the host process, and the package still ships no Typert
  face — and a deployment that disabled the pipeline publishes nothing at all, so
  the absence stays a refusal rather than a silent second converter.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-18)

### 🚀 Features

- Compare two revisions of a document without leaving the plugin. ([38d5f8e](https://github.com/xarleyn/dsh-plugins/commit/38d5f8e))

  `document_compare` reads both sides itself — DOCX through its own OOXML reader,
  Markdown and plain text natively, PDF through the deployment's extraction
  backend — and answers with a comparison artifact, a change summary, the
  extraction quality and a short preview. `document_diff_read` pages through the
  change set with filters by section, kind and signal, so a hundred-page contract
  never arrives as one tool result.

  The diff, not the model, decides what changed: structural alignment (patience
  anchors, then similarity pairing) followed by a token diff over the exact text,
  with moves, table cells and tracked revisions handled as themselves. Every
  change carries a stable id, a location, the text before and after, and the
  deterministic signals the text supports — numbers, amounts, percentages, dates,
  durations, negations, party references, and obligation/permission/prohibition
  vocabulary. Risk is not reported: interpreting the change set is the model's
  half of the split, and the shipped `contract-review` skill states the rule that
  a difference without a `changeId` does not exist.

  A comparison is an artifact like any other (`cmp_<ULID>`, same root, same
  retention) holding the inputs, the canonical IR of each side, `changes.jsonl`,
  a model-free `report.md` and a manifest that makes the run reproducible.
  Comparison runs in-process: no shell, no sockets, no converter between two
  revisions, and its budgets (input bytes, nodes, uncompressed container bytes,
  changes, wall-clock time) are configuration. `documents.comparison.enabled:
  false` leaves both tools unregistered and the skill unmounted.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-17)

### 🚀 Features

- Name the document retention effect after the plugin that owns it. ([7d008a1](https://github.com/xarleyn/dsh-plugins/commit/7d008a1))

  The document pipeline began life inside QA Surface, and one leftover from that
  move survived in the logs: the retention sweep's Cordis effect was registered
  as `dsh-qa-surface.documents-retention`, so a Host operator reading the log
  saw the document retention teardown attributed to a plugin that no longer owns
  it. The effect id is now `dsh-documents.documents-retention`, matching the
  plugin's other effect ids and its settings namespace. Nothing changes at
  runtime — the id is a log/teardown label, and the sweep itself is untouched.


### 🩹 Fixes

- Refresh document-pipeline examples to follow the repository's public ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  documentation conventions. No runtime behavior changes.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

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
