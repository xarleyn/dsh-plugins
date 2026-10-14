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
outputs and a `manifest.json` in one artifact bundle, and exposes
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

For customer-specific proposals and specifications, the bundled
`grounded-documents` skill uses `document_workflow_start/read/update/draft/review/export`
and `document_calculate`. Requirements, facts, exclusions and Markdown revisions
survive interruption. Independent review and authenticated human approval refer
to the exact draft hash. A changed draft or template must be reviewed again.
An active managed workflow refuses finalisation through the general converters.

Workflow state lives under `$DSH_HOME/document-workflows` (or the Host user's
`.dsh/document-workflows`) outside the model-writable workspace. Include it in
the deployment backup. Markdown drafts remain in the session workspace and are
shown as file attachments in QA; the approval action beside a reviewed draft
requests export through the existing agent.

Register a Markdown content template separately from Word styles:

```yaml
templates:
  proposal:
    kind: proposal
    productVersion: "1.0"
    markdown: ./proposal.md
    docx: ./reference.docx
    requiredFacts: [customer, projectGoal, functionalScope]
    requiredSections: [Goal, Functional scope, Commercial terms]
  specification:
    kind: specification
    productVersion: "1.0"
    markdown: ./specification.md
    docx: ./reference.docx
    requiredFacts: [customer, projectGoal, functionalScope]
    requiredSections: [Goal, Functional requirements, Acceptance]
```

Point `documents.templates.root` at this read-only registry directory. A template
for another document kind or product version is refused. Price and quantity
inputs require explicit sources; totals use exact decimal arithmetic with
half-up rounding per line to two decimals. No price or tax treatment is inferred.

| Tool | What it does |
| --- | --- |
| `document_create` | Markdown → DOCX and/or PDF through a registered template, as one artifact bundle |
| `document_to_markdown` | DOCX/PDF → Markdown, with tables, assets and OCR policy |
| `document_from_url` | Fetch an online document or attachment and store its text as an artifact |
| `document_convert` | A supported document to another supported format (`md → docx/pdf`, `docx → pdf/md`, `pdf → md`) |
| `document_inspect` | Type, metadata, page/heading/table counts, encryption and macro flags — without converting |
| `document_compare` | Two documents → a deterministic comparison artifact, a summary and a bounded preview |
| `document_diff_read` | Pages of a comparison's changes, filtered by section, kind and signal |
| `spreadsheet_inspect` | Sheets and dimensions of XLSX/ODS/FODS or a CSV/TSV table, with delimiter/encoding discovery |
| `spreadsheet_read` | Bounded pages of one sheet, typed values, cell addresses, formulas and cached results |
| `spreadsheet_create` | A new XLSX/ODS/FODS workbook or single-table CSV/TSV attachment |

Each producing tool reports its files by their path **inside the session
workspace** — `.qa/artifacts/documents/<id>/report.docx` — which is also the
spelling its own input parameters accept, so a file reported by one call can be
read back by the next. The pipeline works in absolute paths internally and a
tool never hands one to the model: a deployment keeps every account in its own
directory, so an absolute path prints that directory, and the account with it,
into an answer a person reads.

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

## Excel workbooks

Excel tools run in-process through ExcelJS and do not require Pandoc, Docling or
LibreOffice. The bundled `spreadsheets` skill teaches the agent to inspect every
sheet, select sheets by exact name and read them in bounded rectangular pages.
Allow-list `spreadsheet_inspect`, `spreadsheet_read` and `spreadsheet_create` in
deployments that expose Excel to a chat. They follow `documents.enabled` and the
same per-session attachment grants as the document tools.

Reading defaults to 100 rows and 20 columns. At most 2000 cells fit in one call;
long text can shorten the page further under `extraction.maxInlineChars`.
`nextRow` continues the current column window. `nextColumn` starts the next
window, for which row paging starts again at the first requested row. Empty
cells and rows preserve their coordinates; hidden and empty sheets are listed.
Results include the workbook hash so callers can detect changed input between
pages. Dates use ISO values; merged ranges and number formats are explicit.

Creation accepts `sheets: [{ name, rows, headerRow?, freezeRows?, columnWidths? }]`.
Rows contain strings, numbers, booleans, `null`, `{ date: "2026-01-15" }` or
`{ formula: "SUM(B2:B3)", result: 5 }`. Leading-zero identifiers stay strings,
and a plain string beginning with `=` stays text. `headerRow` makes the first
row bold, filterable and frozen by default. The result is a new `.xlsx` artifact
beside `source.json` and `manifest.json`, readable by the same tools; existing
uploads are never overwritten. Creating a spreadsheet observes the managed
document workflow's general render authorization.

Formula values are **cached results from the last save** and can be stale or
absent. The tools do not calculate them; created workbooks request recalculation
when opened in Excel. The Excel path accepts unencrypted XLSX; XLS and macro-enabled
workbooks require an XLSX export. These tools do not render charts or round-trip
an uploaded workbook's full formatting through recreation.

The configured input-byte limit applies alongside XLSX caps: 128 sheets,
100000 rows per sheet, 16384 columns, 200000 stored cells, 2048 ZIP entries and
64 MiB of actual expanded contents. Each range is limited to 200000 cells;
aggregate range area is limited to 800000 cells per worksheet to bound merged
and validation range expansion. A sheet may contain at most 2000 merged ranges;
column declarations obey Excel's column limit and the 200000 expansion budget.
Unsafe archives, macro containers and
unsupported formats are refused before workbook loading.

## Open spreadsheet formats

The same three tools read and create **CSV, TSV, ODS and FODS**. Select output
with `format`; its default remains `xlsx`. Input format is detected from the
container or extension; specify `format` for extensionless text. All formats
use the existing input grants, artifact store, pagination and render authorization.

CSV/TSV have one sheet named `Data`. Fields stay strings, preserving leading
zeroes and exact source spelling. Quoted separators, doubled quotes, embedded
newlines, whitespace, blank records and ragged rows are supported. Blank fields
are empty strings; absent trailing fields in a shorter record are null cells.
CSV detects comma/semicolon/tab/pipe separators; ambiguity requires
`text.delimiter`. TSV always uses tab. Inspect results report `text.delimiter`
and `text.encoding`; reuse them on reads. UTF-8 and UTF-16 BOMs are detected;
without BOM, UTF-8 is assumed. Windows-1251 requires an explicit encoding.

Creation accepts `text: { delimiter?, encoding?, bom?, escapeFormulas? }` and
exactly one sheet for CSV/TSV. Supported encodings are `utf-8`, `utf-16le`,
`utf-16be` and `windows-1251`. Output defaults to UTF-8 with BOM and CRLF.
Booleans export as true/false, numbers retain numeric spelling, dates become
ISO strings and nulls become empty fields. Formula cells are refused. Strings
beginning with formula-trigger characters receive an apostrophe by default;
`escapeFormulas: false` opts into exact literal export, which spreadsheet
applications may interpret as formulas. Legacy encoding cannot silently
replace unrepresentable characters. Styling does not survive a text export.

ODS and its flat XML form FODS support multiple sheets and typed data. The
native bounded reader handles repeated rows/columns, merged ranges and
paragraphs/explicit spaces; trailing full-grid empty repetitions are ignored.
Formula cells use explicit OpenFormula syntax (`of:=SUM([.B2:.B3])`) and saved
results. Expressions are never recalculated or translated from Excel syntax.
Creation writes table data, without XLSX layout options or existing charts and
styles. Macro/script containers, encryption, entity declarations and excessive
repetition are refused. These paths require no external conversion program.

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

The namespace is `documents`, edited in the plugin's own card — the configuration
of this plugin's row on the host **Plugins** page — or declaratively:

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

- `pandoc` and a headless `libreoffice` exist in the deployment image. A missing
  executable is answered at boot by the `documents.installed` record, which names
  every program the check covered and repeats the absent ones as a
  `documents.programs.missing` warning; in a call it surfaces as
  `BACKEND_UNAVAILABLE`, never worked around;
- `docling` is reachable at `http://docling:5001` — the default of the
  `docling-serve` container — and is the backend that reads PDF and DOCX into
  Markdown. `docling.enabled: false` turns that path off;
- `typst` and `markitdown` are disabled. Requesting `pdfMode: typst` without
  `typst.enabled` is refused instead of silently rendering another layout;
  `markitdown` is the optional fast fallback when Docling is unavailable. This
  adapter extracts embedded text; it does not advertise OCR and refuses forced
  OCR. Scanned documents need a separately provisioned OCR backend.

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

## Spreadsheet previews

The Host service exposes optional `inspectSpreadsheet` and `readSpreadsheet`
methods through `DocumentsFace`. Sibling plugins use the same parser, limits and
session input-root policy as the agent tools. The QA files and sources panels
render XLSX, CSV, TSV, ODS and FODS as read-only tables with sheet selection and
bounded navigation across rows and columns. Formula cells display saved results
and expose their expressions in a tooltip; preview does not recalculate formulas
or reproduce workbook styling, merged cells or charts. Existing Word previews
continue to use the document pipeline's PDF conversion.

## License

MIT
