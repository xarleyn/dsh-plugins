# Document comparison — specification

Status: implemented  
Target: `@yadsh/dsh-documents` 0.2.0  
Primary goal: tell two revisions of a document apart — deterministically, in-process, and
without giving the agent a shell.

---

## 1. Summary

The plugin grows two tools and a subsystem behind them:

```text
document_compare      two documents → one comparison artifact, a summary and a preview
document_diff_read    that artifact → pages of changes, filtered
```

The pipeline is fixed:

```text
document A ──▶ extractor ──▶ canonical IR ─┐
                                           ├──▶ alignment ──▶ token diff ──▶ signals
document B ──▶ extractor ──▶ canonical IR ─┘                                        │
                                                                                    ▼
                                                        comparison artifact: summary, changes.jsonl,
                                                        report.md, normalized IRs, manifest
                                                                                    │
                                                                                    ▼
                                                                              the model
                                                                    (interpretation only)
```

The load-bearing sentence of this specification is the last arrow: **the code decides what
changed, the model decides what it means**. A conclusion the model draws is only allowed to
rest on a `changeId` the code produced.

## 2. Goals

- `DOCX ↔ DOCX` is the primary supported case and is read natively: an OOXML package already
  states its paragraph boundaries, table grid, numbering, headers, footnotes and tracked
  revisions, so no converter stands between two revisions of a contract.
- A single replaced word, a single number, a currency, a percentage or a negation is reported
  exactly, with the text before and after.
- Alignment is structural, not positional: an inserted paragraph does not rewrite everything
  below it, and a paragraph moved without edits is a move.
- A big contract produces a bounded tool result and a readable artifact: the model pages
  through the change set instead of receiving it.
- Every change carries a stable id, a location, the exact before/after text and the
  deterministic signals the text supports.
- Same inputs, same options, same plugin version ⇒ byte-identical change set.
- Nothing in the pipeline executes anything, opens a socket, or follows a relationship.

## 3. Non-goals

- Legal or commercial interpretation. The plugin reports that a duration changed; whether that
  is a risk belongs to the skill and the model.
- Approving, rejecting or applying changes.
- Writing tracked changes back into a DOCX.
- Pixel-level layout comparison, and a promise of a perfect diff for OCR'd scans.
- Any fallback path: a comparison that cannot be made returns an error code, and the model is
  never asked to compare two documents by reading them.

## 4. Tools

### 4.1 `document_compare`

Input:

```ts
interface DocumentCompareInput {
  left: { path?: string; artifactId?: string };
  right: { path?: string; artifactId?: string };
  mode?: "default" | "contract";
  scope?: "body" | "all";
  options?: {
    detectMoves?: boolean;
    includeHeaders?: boolean; includeFooters?: boolean;
    includeFootnotes?: boolean; includeComments?: boolean;
    ignoreWhitespace?: boolean; ignoreFormatting?: boolean;
  };
}
```

A side is named by exactly one of `path` (resolved inside the session scope) or `artifactId`
(an artifact this session produced earlier — its retained input if it has one, otherwise the
file it produced).

Result: `comparisonId`, both sides' name/hash/format/node count, `quality`, `summary`,
`preview` (bounded), `changesPath`, `reportPath`, `manifestPath`, `warnings`. The tool never
returns either document.

### 4.2 `document_diff_read`

```ts
interface DocumentDiffReadInput {
  comparisonId: string;
  cursor?: string;      // opaque; from nextCursor
  limit?: number;
  filters?: { section?: string; kinds?: ChangeKind[]; signals?: string[] };
}
```

`signals` accepts the signal codes and the short family names (`money`, `deadline`,
`obligation`, …); an unknown value is an error, never a filter that silently matches nothing.
A cursor names a position in one filtered stream: reusing it under different filters is
refused.

## 5. Modes and defaults

`mode: "contract"` is the deployment default (`comparison.defaultMode`) and is deliberately
conservative:

| Option | contract | default |
| --- | --- | --- |
| `detectMoves` | `true` | `true` |
| `includeHeaders` / `includeFooters` / `includeFootnotes` | `true` | deployment (`true`) |
| `includeComments` | deployment (`false`) | deployment (`false`) |
| `ignoreWhitespace` | `true` | deployment (`true`) |
| `ignoreFormatting` | `true` | deployment (`true`) |
| `scope` | `all` | `body` |

There is deliberately no `ignoreCase`, `ignorePunctuation` or `ignoreNumbers`: no supported
option normalizes away case, punctuation or numbers, and an option that existed but did
nothing would be worse than its absence.

## 6. Canonical IR

Every input becomes the same shape before anything is compared (§8, §9 of the design):

```ts
interface CanonicalNode {
  id: string;                  // "<part>:<index>", stable within the document
  type: "heading" | "paragraph" | "list-item" | "table" | "table-row"
      | "table-cell" | "footnote" | "comment";
  part: "body" | "header" | "footer" | "footnote" | "comment";
  level?: number;
  path: readonly string[];     // the heading stack the node sits under
  rawText: string;             // exact extracted text: the before/after of a change
  comparisonKey: string;       // normalized text: alignment only, never shown
  source: { page?; paragraph?; table?; row?; column?; xmlPath? };
  revisions?: readonly { type: "insert" | "delete"; author?; date?; text? }[];
  formatting?: string;         // only when ignoreFormatting is off
  table?: { rows: { row; cells: { column; rawText; comparisonKey; source }[] }[] };
}
```

`type` says what a node is, `part` says where it came from: a paragraph in a header is a
paragraph with `part: "header"`, which is what keeps headers aligning with headers.

### 6.1 The two texts

- `rawText` is never silently normalized. It is what a change reports, and a token diff over it
  reproduces each side exactly.
- `comparisonKey` folds representation only: NFC, NBSP and exotic spaces, soft hyphens and
  zero-width characters, whitespace runs. It never folds meaning — `не`, `10`, `%`, `руб.` and
  `должен` all survive it.

## 7. Extractors

```ts
interface StructuredDocumentExtractor {
  name: string;
  supports(filename: string): boolean;
  extract(input: StructuredExtractionInput): Promise<CanonicalDocument>;
}
```

| Extractor | Formats | Reads |
| --- | --- | --- |
| `native-docx` | `.docx` | the OOXML package itself |
| `markdown` | `.md`, `.markdown`, `.mdown`, `.mkd` | block constructs, GFM tables |
| `plain-text` | `.txt` | one paragraph per non-blank line |
| `pdf` | `.pdf` | the deployment's extraction backend → Markdown → the Markdown extractor |

The DOCX extractor is the reason the feature exists: `DOCX → converter → Markdown → diff`
would put a renderer between two revisions and let its line wrapping and table flattening
become the answer. It reads `word/document.xml`, `word/styles.xml`, `word/header*.xml`,
`word/footer*.xml`, `word/footnotes.xml` and `word/comments.xml` with a hardened XML reader of
its own (no XML dependency in the host process), and keeps paragraphs, headings (outline level
or style), numbering (list level), tables (rows, cells, `gridSpan` column arithmetic),
footnotes, comments and tracked revisions.

Tracked revisions (§12 of the design): insertions count as text — that is what Word shows —
deletions are recorded as revisions and left out of it, and a document that carries revisions
raises `TRACK_CHANGES_PRESENT`, so the model knows the two sides may already contain edits
someone made on purpose.

### 7.1 Quality

| Level | Meaning |
| --- | --- |
| `high` | both sides native and of the same format (DOCX/DOCX, MD/MD, TXT/TXT) |
| `medium` | a PDF pair with a text layer |
| `low` | OCR was used, the formats differ, or an extraction said so |

The level sets the ceiling of every change's confidence. OCR text is never presented as exact.

## 8. Diff

### 8.1 Alignment

Nodes are aligned per document part (body, headers, footers, footnotes, comments) in two steps:

1. **patience anchors** — nodes whose key is identical *and* unique on both sides; the longest
   increasing run of those matches is taken as anchors. Identical text that appears once cannot
   be mismatched, which is why it is matched first.
2. **similarity pairing in the gaps** — the best remaining pair above a threshold, scored as the
   larger of the token-overlap (Sørensen–Dice) and the character similarity (bounded edit
   distance, for short paragraphs where token overlap is too coarse). Nodes of different kinds
   may pair only at a higher threshold.

Everything left over is a deletion or an insertion. A deleted and an inserted node with byte-
identical text (part, kind and text) are reported as one `move`.

A gap too large to score pairwise (250 000 candidate pairs) falls back to positional pairing,
and a token pair too large for the diff table (4 000 000 cells) is reported as one whole
replacement: the change stays exact, it is just not decomposed further.

### 8.2 Token diff

A longest-common-subsequence walk over Unicode-aware tokens (words with internal joins, numbers
with internal separators, whitespace, punctuation), after trimming the common prefix and
suffix. Ties break towards deletion; the spans of one side always reassemble that side exactly.

### 8.3 Changes

```ts
interface DocumentChange {
  id: string;                     // chg_<12 hex>, stable across runs
  kind: "insert" | "delete" | "replace" | "move";
  nodeType: DocumentNodeType;     // a cell change is a table-cell replace
  left?: ChangeLocation;
  right?: ChangeLocation;
  before?: string; after?: string;
  spans?: { kind: "equal" | "delete" | "insert"; text: string }[];
  context: { headingPath: string[]; previous?: string; next?: string };
  signals: ChangeSignal[];
  confidence: number;             // 0..1: quality ceiling × pairing certainty
}
```

`id = sha256(leftHash + rightHash + part + kind + locations + before + after)`, truncated and
suffixed for duplicates. Ordering is the order of the revised document, with a deletion
attached to the position where it disappeared.

Table cells are compared as cells: the change carries the grid coordinates
(`table`, `row`, `column`), which is far more useful to a reader than a flattened table.

### 8.4 Signals

Facts, never verdicts: `MONEY_CHANGED`, `NUMBER_CHANGED`, `PERCENTAGE_CHANGED`, `DATE_CHANGED`,
`DURATION_CHANGED`, `NEGATION_CHANGED`, `PARTY_REFERENCE_CHANGED`, `URL_CHANGED`,
`EMAIL_CHANGED`, `OBLIGATION_TERM_CHANGED`, `PERMISSION_TERM_CHANGED`,
`PROHIBITION_TERM_CHANGED`, `LIABILITY_TERM_CHANGED`, and `FORMATTING_CHANGED` when formatting
is compared.

Each detector extracts a set of features from each side and reports a difference between the
sets: an amount with its currency, a normalized date, a duration with its unit, a number, a
percentage, a vocabulary class. The plugin never says "risky" — it says what it saw.

## 9. Artifact

A comparison is an artifact like any other: same root, same manifest, same retention, with a
`cmp_<ULID>` id and `kind: "document-comparison"` in the manifest.

```text
.qa/artifacts/documents/cmp_01J…/
├── manifest.json        operation document_compare, kind document-comparison,
│                        both sides (sha256, filename, format, nodes), engine, options,
│                        quality, summary, changesPath, reportPath
├── inputs/left.docx     the bytes that were compared, when retainInputs is on
├── inputs/right.docx
├── normalized/left.json canonical IR, deterministic serialization (retainNormalizedDocuments)
├── normalized/right.json
└── diff/
    ├── summary.json     the same facts, in one document
    ├── changes.jsonl    one change per line — the reader streams it
    └── report.md        the human-readable, model-free report
```

`document_diff_read` streams `changes.jsonl`: it never loads the whole change set, and
`remaining` is counted rather than guessed.

## 10. Security

- **No shell, ever.** Nothing in the comparison pipeline spawns a process; a build-time check
  asserts that no comparison module can reach `child_process`.
- **No network.** External relationships in a package are names in XML; the comparison never
  follows one. A test injects a `fetch` spy and asserts it is never called.
- **Containment.** Both sides are resolved with the pipeline's existing path rules: inside the
  session workspace, the artifact root or a configured document root, with symlinks followed
  and escapes refused.
- **Bounded everything.** Input bytes per side, nodes per side, uncompressed bytes decompressed
  from a container, changes per comparison, a wall-clock budget, and a hard cap on the entry
  size a ZIP member may inflate to. A refusal carries a code; nothing degrades silently.
- **Refused inputs**: macro-enabled documents (`MACRO_ENABLED_DOCUMENT`), encrypted OOXML and
  encrypted PDFs (`COMPARE_ENCRYPTED_DOCUMENT`), unsupported containers
  (`COMPARE_UNSUPPORTED_FORMAT`), malformed XML (`COMPARE_PARSE_FAILED`).
- The XML reader decodes only the five predefined entities and numeric character references,
  and refuses any other entity reference: XXE and billion-laughs payloads cannot be expressed.

## 11. Errors

| Code | Raised when |
| --- | --- |
| `COMPARE_UNSUPPORTED_FORMAT` | a side is not DOCX/Markdown/TXT/PDF |
| `COMPARE_PARSE_FAILED` | a container claims to be supported and cannot be read |
| `COMPARE_ENCRYPTED_DOCUMENT` | a password-protected OOXML or PDF |
| `COMPARE_INPUT_TOO_LARGE` | a side exceeds `comparison.maxInputBytes` |
| `COMPARE_TOO_MANY_NODES` | a side exceeds `comparison.maxNodes` |
| `COMPARE_TIMEOUT` | the comparison exceeded `comparison.timeoutMs` |
| `COMPARE_DIFF_LIMIT_EXCEEDED` | the change set exceeds `comparison.maxChanges` |
| `COMPARE_LOW_EXTRACTION_QUALITY` | a side produced no text at all |
| `COMPARE_ARTIFACT_NOT_FOUND` | an artifact reference or a comparison id is unknown, or is not a comparison |
| `MACRO_ENABLED_DOCUMENT` | a macro-enabled document (the pipeline's existing code) |
| `BACKEND_UNAVAILABLE` | comparison is disabled, or no PDF extractor is configured |

## 12. Configuration

```yaml
documents:
  comparison:
    enabled: true
    defaultMode: contract
    detectMoves: true
    includeHeaders: true
    includeFooters: true
    includeFootnotes: true
    includeComments: false
    ignoreWhitespace: true
    ignoreFormatting: true
    maxInputBytes: 52428800
    maxNodes: 100000
    maxChanges: 50000
    maxUncompressedBytes: 268435456
    timeoutMs: 120000
    inlineChanges: 20
    inlineTextCharsPerChange: 4000
    pageSize: 20
    maxPageSize: 200
    retainNormalizedDocuments: true
```

`comparison.enabled: false` removes `document_compare` and `document_diff_read` from the
registry entirely — the surface is absent rather than inert — and unmounts the skill.

## 13. Skill

`skills/contract-review/SKILL.md` ships in the package and is mounted as a filesystem skill
provider (`providerName: "documents"`, bundled root only). It states the invariant — semantic
analysis must rest on `document_compare`/`document_diff_read` results, and a difference without
a `changeId` does not exist — the workflow, what each signal means, and the report shape that
cites a `changeId` per conclusion. A deployment that turns comparison off does not mount it.

The dedicated preset of §37 is a deployment's business, not the plugin's: the three tools
(`document_inspect`, `document_compare`, `document_diff_read`) are enough for the workflow, and
a deployment that wants a contract-review chat restricts its allow-list to them.

## 14. Tests

| File | Covers |
| --- | --- |
| `documents-comparison-diff.test.ts` | the change table of the design (one word, a number, a currency, a negation, a move, a cell, whitespace, punctuation), change records, determinism, token diff, tokenizer, similarity, signals |
| `documents-comparison-docx.test.ts` | the package reader: structure, styles, tables and `gridSpan`, headers/footers/footnotes/comments, tracked revisions, formatting signatures, refusals, the XML reader |
| `documents-comparison-tools.test.ts` | both tools end to end: the artifact layout, the manifest, the report, artifact references, `scope`, budgets, cursors, filters, registration |
| `documents-comparison-golden.test.ts` | golden cases with the full change shape written down, generated mutations, 20-run stability, quality of the lossy formats, PDF comparison, configuration |
| `documents-comparison-security.test.ts` | containment, traversal, symlinks, oversized inputs, ZIP bombs, node floods, no network, no backend |
| `documents-skills.test.ts` | the shipped skill and its provider |
