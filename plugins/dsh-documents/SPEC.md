# `@yadsh/dsh-documents` — plugin specification

The document pipeline as a standalone DSH plugin: five semantic tools over a
managed set of document backends, with an artifact bundle as the unit of work.

## 1. Summary

The plugin registers `document_create`, `document_to_markdown`,
`document_from_url`, `document_convert` and `document_inspect` into the Host
tool registry under the `documents` settings namespace. Markdown is the
canonical intermediate representation: the agent writes Markdown and receives
DOCX/PDF, or hands over a document and receives Markdown plus a manifest that
records what produced it.

The pipeline itself — providers, orchestration, artifact store, templates,
limits — is specified in
[`docs/specs/document-pipeline.md`](./docs/specs/document-pipeline.md). That
document remains authoritative for everything below the plugin surface.

## 2. Goals

- One place owns document backends: no prompt, skill or workflow names
  `pandoc`, LibreOffice, Docling or a converter flag.
- A deployment can install the capability without the QA surface, and a QA chat
  keeps exactly the tool names it had.
- Everything the pipeline produces is traceable: one bundle per operation with
  the source, the assets, the outputs and `manifest.json`.
- Size, resource and retention limits are configuration, expressed in the same
  schema the settings card edits.

## 3. Non-goals

- Authoring documents *for* an agent (report layouts, editorial templates) —
  the pipeline renders; the composition decides the content.
- Replacing the artifact store with a shared document management system.
- Serving document bytes to the model. The harness body union is `html | text`;
  files are produced in the workspace and read from there by path.

## 4. Surface

### 4.1 Tools

| Tool | Operation |
| --- | --- |
| `document_create` | Markdown + template → DOCX and/or PDF |
| `document_to_markdown` | DOCX/PDF → Markdown, assets, optional OCR |
| `document_from_url` | URL → stored Markdown artifact |
| `document_convert` | supported format → supported format |
| `document_inspect` | structure and metadata without conversion |

Registration is conditional on `enabled`; visibility is the deployment's
allow-list. An unknown name in an allow-list fails a session closed, so a
deployment that lists these tools must install the plugin.

### 4.2 Configuration

One namespace, `documents`, with the shape of `src/schema.ts`; defaults come from
`src/documents/defaults.ts` and are resolvable without a settings layer, so the
same values serve tests, the CLI and the card. Environment overrides
(`DSH_DOCUMENTS_*`) are applied at startup by the plugin entry, and the settings
namespace stays authoritative for everything it declares.

### 4.3 Settings card

A self-contained browser bundle registering a card into `settings.plugin.item`,
keyed by the namespace. It edits configuration only — no document operation is
reachable from the UI. Its controls use the shared card shell and the
`--dsw-alias-*` design tokens (AGENTS.md).

## 5. Session scope

Every operation resolves its roots from the calling session's working directory
(`exec.agent.session.header.cwd`), failing closed when there is none. Two
layouts are supported:

- per-session (default): `<cwd>/.qa/artifacts/documents/<id>`, which keeps one
  account's documents inside its own workspace;
- pinned: `storage.root` points at a shared volume, and only then does the
  retention sweep run, because with per-session directories the plugin cannot
  enumerate other sessions' workspaces.

The legacy QA-era directory name (`.qa/artifacts/documents`) is deliberately
kept: renaming it would orphan existing artifacts for no functional gain.

## 6. Security and limits

- backends are invoked with argument vectors assembled by the plugin; the model
  never supplies a flag, and provider output is sanitized before it can reach an
  error message;
- path inputs are contained to the session workspace (or the configured
  document roots) and rejected otherwise;
- every stage has a configured cap: input bytes, pages, images, asset bytes,
  Markdown characters, inline response characters, backend timeouts;
- `document_from_url` performs no network I/O of its own: retrieval goes through
  the harness web seam, so the deployment's rules, credentials and address
  policy apply unchanged.

## 7. Compatibility

`compatibility.json` states the supported harness range and the host features
the plugin relies on (`tools/register`, `settings`), plus the client feature
(`settings.plugin.item`). Nothing here needs a Remote service, so the package
ships no generated Typert face.
