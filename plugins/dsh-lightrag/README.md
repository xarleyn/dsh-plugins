# @yadsh/dsh-lightrag

Knowledge-base tools for DeepSeek Harness agents: the model can ask what a
[LightRAG](https://github.com/HKUDS/LightRAG) graph-RAG index knows about a
topic — and what the index holds and how healthy it is — without ever receiving
an HTTP client.

## Features

- **Three read tools**, registered into the host tool catalog:
  - `dsh_lightrag_query` — answer a question from the index and return the
    references it was built from (file paths, optionally chunk text); the
    answer carries `truncated` and `llmGenerated`, the latter false when the
    server returned its canned "no context" reply;
  - `dsh_lightrag_documents` — list the indexed documents with their ingestion
    status, chunk count, size and failure reason, plus per-status counts;
  - `dsh_lightrag_status` — server health, core/API version, whether the
    ingestion pipeline is busy, and the document counts per status. Call it
    first when the index looks empty: it separates "server down" from
    "nothing ingested".
- **Three write tools, off by default** (`writes.enabled`): `dsh_lightrag_insert`
  (text in), `dsh_lightrag_scan` (ingest new files from the server's own input
  directory) and `dsh_lightrag_delete` (drop one document's index entry). While
  the switch is off they are not registered at all, so a deployment that runs
  agents read-only cannot have them named by a tool allow-list either.
- **One configured origin, one HTTP client.** Every request is built by the
  plugin against the operator's `endpoint`; the model can neither choose a host
  nor add a path. Responses are read through a byte cap, requests through a
  wall-clock budget, and both are reported as typed failures rather than raw
  transport errors.
- **Stable error codes with operator hints.** `unreachable`, `unauthorized`,
  `not-found`, `rate-limited`, `server-error`, `timeout`, `bad-response`,
  `too-large`, `invalid-argument` and `disabled` — each with the one-line action
  that usually fixes it, so a deployment's runbook and the model see the same
  vocabulary.
- **Bounded output.** The answer is capped by `query.maxAnswerBytes` (cut at a
  UTF-8 boundary and marked), the listing by `documents.maxListed`, and an
  insert above `writes.maxTextBytes` fails before any request is made.

## Security model

- The tools never hand the model a URL, a header or a request body: arguments
  are structured fields, and the plugin composes the HTTP call.
- `endpoint` must be a bare `http(s)` origin. Credentials, a path, a query or a
  fragment are rejected when the configuration loads, so a mistyped endpoint
  cannot send a request somewhere unintended.
- The API key is sent as `X-API-Key` and never appears in a tool result or in a
  log record; the log carries sizes, counts and durations only.
- `dsh_lightrag_delete` removes the index entry and the extracted graph data,
  and passes `delete_file: false`: the source file in the server's input
  directory is left for the operator, so a mistaken delete can be undone by a
  scan.
- **Retrieved content is untrusted data from the knowledge base, not
  instructions.** Anything ingested into the index is written by whoever can
  write to it, so an answer or a chunk is context, never authority. Treat text
  coming back from these tools the way you treat the contents of a fetched
  page.

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile <profile> add @yadsh/dsh-lightrag
```

The plugin has no web-client surface; a host restart (or bundle reload) picks
it up. Tools appear as `dsh_lightrag_query`, `dsh_lightrag_documents` and
`dsh_lightrag_status` in new agent sessions.

### Use in restricted agent presets

The tools are ordinary host tools, so a locked-down composition grants them the
same way it grants any other: mount the plugin in the preset's
`agent.cordis.yml`, then name the tools in the deployment's
`lockdown.toolPolicy.allow` list and in the preset's `toolFilter`:

```yaml
# preset rows (agent.cordis.yml)
- id: dsh-lightrag
  name: "@yadsh/dsh-lightrag"
  config:
    endpoint: http://lightrag:9621

# lockdown.toolPolicy.allow — the read set:
#   - dsh_lightrag_query
#   - dsh_lightrag_documents
#   - dsh_lightrag_status
```

The mount must exist before the allow-list entry: an allow-list naming a tool
that never registers refuses the attestation. Add `dsh_lightrag_insert`,
`dsh_lightrag_scan` and `dsh_lightrag_delete` only to a composition that also
sets `writes.enabled: true` — the compiled bundle for that row must carry the
same configuration, which means a separate preset row rather than an edit to a
read-only one.

## Configuration

Configure the plugin under the `lightrag` key in the DSH profile.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Register the knowledge-base tools. When false, no tool is registered. |
| `endpoint` | string | `http://127.0.0.1:9621` | Origin of the LightRAG server, e.g. `http://lightrag:9621`. Must be a bare `http(s)` origin — no credentials, path, query or fragment. |
| `apiKey` | string | `""` | API key sent as `X-API-Key`. Empty falls back to the `LIGHTRAG_API_KEY` environment variable. |
| `timeoutMs` | number | `60000` | Wall-clock budget per HTTP request, clamped to 1000–300000 ms. |
| `query.mode` | string | `mix` | Default retrieval mode: `local`, `global`, `hybrid`, `naive`, `mix` or `bypass`. An unknown value falls back to `mix`. |
| `query.topK` | number | `20` | Documents retrieved per query, clamped to 1–200. The server allows 1000; a review tool does not need it. |
| `query.maxAnswerBytes` | number | `200000` | Byte cap for the returned answer, clamped to 1 KiB–1 MiB. The answer is cut at a UTF-8 boundary and marked. |
| `documents.maxListed` | number | `200` | Maximum documents listed in one call, clamped to 1–1000. |
| `writes.enabled` | boolean | `false` | Register `dsh_lightrag_insert`, `dsh_lightrag_scan` and `dsh_lightrag_delete`. |
| `writes.maxTextBytes` | number | `200000` | Byte cap for one inserted text, clamped to 1 KiB–1 MiB. An insert above it fails before any request. |

Retrieval modes, briefly: `local` searches entities, `global` relations,
`hybrid` both, `naive` plain vector chunks, `mix` combines graph and vector
retrieval (the server's own default), and `bypass` skips retrieval and answers
from the model alone — useful for telling "the index has nothing" apart from
"the model ignored the context", and unreachable unless the caller asks for it
by name.

### Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `dsh_lightrag_query` | `question` (required), `mode`, `topK`, `withContent` | Answer text (bounded), `referenceCount`, `llmGenerated`, `truncated`, and one entry per cited source: `referenceId`, `filePath`, `content` (chunk text when `withContent` is true). |
| `dsh_lightrag_documents` | `status`, `limit` | One entry per document: `id`, `filePath`, `status`, `chunksCount`, `contentLength`, `updatedAt`, `errorMessage`; plus `count`, `totalCount`, `truncated` and `statusCounts` for the whole knowledge base. |
| `dsh_lightrag_status` | — | `status`, `coreVersion`, `apiVersion`, `authMode`, `pipelineBusy`, `statusCounts`. |
| `dsh_lightrag_insert` | `text` (required), `source` | `trackId`, `status`, `message`. Ingestion is asynchronous. |
| `dsh_lightrag_scan` | — | `trackId`, `status`, `message`. |
| `dsh_lightrag_delete` | `documentId` (required) | `status`, `message`, `docId`. |

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0` (channel `next`), host feature
  `tools/register`.
- Node `^22.19.0 || >=24.0.0`.

The machine-readable contract is
[`compatibility.json`](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-lightrag/compatibility.json).

The product contract, including the verified LightRAG HTTP API this plugin
speaks, is
[`SPEC.md`](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-lightrag/SPEC.md).

## Development

```bash
pnpm --filter @yadsh/dsh-lightrag build       # tsc -p tsconfig.build.json
pnpm --filter @yadsh/dsh-lightrag test        # vitest
pnpm --filter @yadsh/dsh-lightrag check       # lint, typecheck, test, build, verify
```

No test reaches the network: the HTTP client takes a `fetch` seam and the suites
drive it with a recording stub.

## License

MIT — see [LICENSE](./LICENSE).
