# @yadsh/dsh-documents

Managed document pipeline for the DeepSeek Harness: the agent writes Markdown
and receives DOCX/PDF, hands over a DOCX/PDF and receives Markdown, or stores
the text of an online source — a wiki attachment, a document behind an
authenticated fetch provider — as an artifact it can work with.

It also tells two revisions of a document apart, deterministically and in the
process: an OOXML package is read natively — paragraphs, tables, numbering,
headers, footnotes, tracked revisions — and the diff, not the model, decides
what changed. The model is given a change set with stable ids and interprets it.

The plugin owns every backend command line, keeps the source, the assets, the
outputs and a `manifest.json` in one artifact bundle, and exposes seven
semantic tools. An agent never calls `pandoc`, LibreOffice, Docling or a
converter flag directly, so a deployment can replace a backend without touching
a prompt, a skill or a workflow.

It is deliberately not part of `@yadsh/dsh-qa-surface`: it reads the calling
session's working directory, registers plain agent tools, and asks the
deployment's web provider for online sources. Any agent composition can use it,
and a QA chat reaches it through the same names it always did.

## Installation

```bash
npm install @yadsh/dsh-documents
# or, into a profile:
dsh plugin --profile <profile> add @yadsh/dsh-documents
```

The package ships `cordis.patch.yml`, so the DSH plugin manager inserts its row
into the profile bundle; add it to `dsh.profile.bundles` if your deployment
lists bundles explicitly.

## Tools

| Tool | What it does |
| --- | --- |
| `document_create` | Markdown → DOCX and/or PDF through a registered template, as one artifact bundle |
| `document_to_markdown` | DOCX/PDF → Markdown, with tables, assets and OCR policy |
| `document_from_url` | Fetch an online document or attachment and store its text as an artifact |
| `document_convert` | A supported document to another supported format (`md → docx/pdf`, `docx → pdf/md`, `pdf → md`) |
| `document_inspect` | Type, metadata, page/heading/table counts, encryption and macro flags — without converting |
| `document_compare` | Two documents → a deterministic comparison artifact, a summary and a bounded preview |
| `document_diff_read` | Pages of a comparison's changes, filtered by section, kind and signal |

Tool registration follows the configuration: `documents.enabled: false` (or a
resolved `enabled: false` from the environment) leaves them unregistered rather
than inert, and `documents.comparison.enabled: false` does the same for the
comparison pair. Visibility to a chat is the deployment's decision, not the
plugin's:

```yaml
# profile settings of a deployment that wants the tools in a chat
lockdown:
  toolPolicy:
    allow:
      - document_create
      - document_to_markdown
      - document_from_url
      - document_convert
      - document_inspect
```

Every name must exist in the session's tool catalog, so the plugin must be
installed and enabled wherever the allow-list mentions it.

## Comparing two revisions

```text
document_inspect        what the two files are
document_compare        what changed — computed here, not by the model
document_diff_read      every change, paged and filtered
```

`document_compare` reads both sides itself: DOCX (through its own OOXML reader,
no converter in between), Markdown and plain text natively, and PDF through the
deployment's extraction backend. It answers with a `comparisonId`, the change
summary, the extraction quality and a short preview; the artifact holds the rest:

```text
.qa/artifacts/documents/cmp_01J…/
├── manifest.json       kind: document-comparison, both hashes, engine, options, quality
├── inputs/left.docx    the bytes that were compared
├── normalized/*.json   the canonical IR of each side
└── diff/
    ├── changes.jsonl   one change per line
    ├── summary.json
    └── report.md       the model-free human report
```

Every change carries a stable id, a location, the exact text before and after,
and the deterministic signals the text supports — a changed number, amount,
percentage, date, duration, negation, party, or obligation/permission/prohibition
vocabulary. The plugin reports facts; risk is the model's business, and the
`contract-review` skill (shipped with the package) states the rule: semantic
analysis must rest on `document_compare` results, and a difference without a
`changeId` does not exist.

A contract-review chat needs no shell and no Markdown extraction — three tools
are enough:

```yaml
lockdown:
  toolPolicy:
    allow:
      - document_inspect
      - document_compare
      - document_diff_read
```

Refusals carry codes instead of degrading: `COMPARE_UNSUPPORTED_FORMAT`,
`COMPARE_PARSE_FAILED`, `COMPARE_ENCRYPTED_DOCUMENT`, `COMPARE_INPUT_TOO_LARGE`,
`COMPARE_TOO_MANY_NODES`, `COMPARE_TIMEOUT`, `COMPARE_DIFF_LIMIT_EXCEEDED`,
`COMPARE_LOW_EXTRACTION_QUALITY`, `COMPARE_ARTIFACT_NOT_FOUND`. There is no
fallback to a shell and no request that the model compare the documents itself.

## Configuration

The namespace is `documents`, edited in the plugin's own card (Settings →
Plugins → Документы) or declaratively:

```yaml
- id: documents
  name: '@yadsh/dsh-documents'
  config:
    enabled: true
    storage:
      root: null            # null = <session workspace>/.qa/artifacts/documents
      retainSource: true
      retainInputs: true
    extraction:
      defaultMode: accurate # auto | fast | accurate
      ocr: auto             # auto | off | force
      extractImages: true
      maxInlineChars: 200000
    docling:
      enabled: true
      baseUrl: http://docling:5001
    pandoc:
      executable: pandoc
    libreoffice:
      executable: libreoffice
    retention:
      enabled: true
      maxAgeDays: 30
    limits:
      maxInputBytes: 52428800
      maxPages: 1000
    comparison:
      enabled: true
      defaultMode: contract    # contract | default
      detectMoves: true
      includeHeaders: true
      includeFooters: true
      includeFootnotes: true
      ignoreWhitespace: true
      ignoreFormatting: true
      maxNodes: 100000
      maxChanges: 50000
      timeoutMs: 120000
      inlineChanges: 20
```

What the defaults assume:

- `pandoc` and a headless `libreoffice` exist in the deployment image. Missing
  executables surface as `BACKEND_UNAVAILABLE`, never worked around;
- `docling` is reachable at `http://docling:5001` — the default of the
  `docling-serve` container — and is the backend that reads PDF and DOCX into
  Markdown. `docling.enabled: false` turns that path off;
- `typst` and `markitdown` are disabled. Requesting `pdfMode: typst` without
  `typst.enabled` is refused instead of silently rendering another layout;
  `markitdown` is the optional fast fallback when Docling is unavailable.

## Artifacts and sizes

Each operation writes a bundle under
`<session workspace>/.qa/artifacts/documents/<id>` containing `manifest.json`,
the Markdown source, the assets and the produced files. `storage.root` pins one
absolute root instead (a mounted volume); retention cleanup runs only in that
layout, because with per-session directories the plugin cannot enumerate other
sessions' workspaces.

The limits are configuration, not constants: `limits.maxInputBytes` (input
file), `limits.maxMarkdownChars` (Markdown the pipeline will hold),
`limits.maxPages`, `limits.maxExtractedImages`, `limits.maxAssetBytes`, and
`extraction.maxInlineChars` (how much extracted Markdown is returned to the
model — the artifact always keeps the whole text).

`document_from_url` opens no socket of its own: it asks the deployment's web
provider for the URL, so the fetch rules, credentials, address policy and
byte/char caps configured there decide what may be read (in practice
[`@yadsh/dsh-web-fetch-authenticated`](https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-web-fetch-authenticated#readme),
including its Confluence attachment support). Without a web provider the tool
answers `BACKEND_UNAVAILABLE` instead of guessing.

The pipeline writes its bundles with its own file-system calls, so a read-only
sandbox does not stop a document from being created. The allow-list is the
switch that decides whether a chat can write documents at all, and
`storage.root` decides where they land.

## Environment overrides

Environment wins over the settings namespace at startup, which is how a
container pins a shared volume or a service address without editing settings:

| Variable | Effect |
| --- | --- |
| `DSH_DOCUMENTS_ENABLED` | enable/disable the pipeline |
| `DSH_DOCUMENTS_STORAGE_ROOT` | absolute artifact root |
| `DSH_DOCUMENTS_TEMPLATES_ROOT` | absolute template root |
| `DSH_DOCUMENTS_DOCLING_BASE_URL` | docling-serve address |
| `DSH_DOCUMENTS_DOCLING_TIMEOUT_MS` | Docling request timeout |
| `DSH_DOCUMENTS_PANDOC_EXECUTABLE` | pandoc binary |
| `DSH_DOCUMENTS_LIBREOFFICE_EXECUTABLE` | LibreOffice binary |
| `DSH_DOCUMENTS_MARKITDOWN_EXECUTABLE` | markitdown binary |
| `DSH_DOCUMENTS_OCR_LANGUAGES` | comma-separated OCR languages |
| `DSH_DOCUMENTS_MAX_INPUT_BYTES` | input file cap |

The card shows what the browser wrote; the Host logs the values it resolved.

## Migrating from `dsh-qa-surface`

The pipeline used to live inside the QA surface. The move changes configuration
and nothing else:

- tool names and the artifact layout are unchanged, so allow-lists and existing
  artifacts keep working;
- the `documents` section moves from the `qa-surface` namespace to this plugin's
  `documents` namespace, and `QA_DOCUMENTS_*` / `QA_DOCLING_*` / `QA_PANDOC_*` /
  `QA_LIBREOFFICE_*` / `QA_MARKITDOWN_*` become the `DSH_DOCUMENTS_*` names above;
- a leftover `documents:` section under `qa-surface` is ignored, and the QA
  surface logs `documents.moved` once per configuration change so the leftover
  does not silently take the Docling endpoint with it;
- deployments that allow-list the tools must install this plugin, otherwise the
  names are missing from the session catalog and attestation fails closed.

## Design

The pipeline's design — provider interfaces, extraction routes, artifact
manifest, security and resource limits — is in
[`docs/specs/document-pipeline.md`](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-documents/docs/specs/document-pipeline.md),
deterministic comparison in
[`docs/specs/document-comparison.md`](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-documents/docs/specs/document-comparison.md),
and the plugin surface itself in [`SPEC.md`](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-documents/SPEC.md).

## License

MIT
