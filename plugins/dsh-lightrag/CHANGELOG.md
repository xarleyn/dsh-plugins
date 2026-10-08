## 0.2.3 (2026-10-08)

### 🩹 Fixes

- Every plugin row on the Host's Plugins page is named in words. ([fff88762](https://github.com/xarleyn/dsh-plugins/commit/fff88762))

  The page titles a bundle's row and fills its description line from the package's
  exported `locale/en.json`, which the Host resolves through the package's `exports`
  map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
  Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
  their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
  first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
  `locale/*.json`, and carries English `meta.title` and `meta.description`; where the
  package already had a configuration card, its `summary` one-liner and the row's
  description are one string, pinned by a test against the shipped file rather than
  against a copy in the test. `pnpm verify:packages` asks all three halves of every
  plugin package, so a row cannot fall back to a specifier unnoticed.

  Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
  panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
  row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
  namespace the Host serves the form under, so no saved value is orphaned — and with the
  seat it gives up its shell, its header badge and its show/hide labels, taking the
  Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
  unavailable namespace with a sentence instead of an empty section.
  `dsh-domain-experts` owns no form — it edits domains through its Remote services — so
  it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
  drops the `<h2>` heading and the intro line the panel already draws from the row's own
  display metadata.

### ❤️ Thank You

- xarleyn

## 0.2.2 (2026-10-04)

### 🩹 Fixes

- Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover. ([#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))

  `compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
  release, and the Requirements/Compatibility lines of the README and SPEC that
  restate that pair moved with it, so a package page and its manifest agree. The
  checks that hard-code the pair moved in the same change: two `deepEqual`
  assertions in the package verifiers, one bundle test, the plugin generator's
  scaffold defaults with its test, and the fixtures of the repository gates that
  read them.

  Dated records keep the version they were written against. Phase 0 and spike
  findings documents, `SPEC` baseline tags and permalinks into the harness tree,
  and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
  what was observed on that host rather than what the package supports now.

- A retrieval call now ends within `timeoutMs` even when the server stops ([#347](https://github.com/xarleyn/dsh-plugins/issues/347))
  mid-answer.

  The budget used to cover the response headers only: the timer was cleared the
  moment `fetch` resolved, so a LightRAG server that answered and then stopped
  delivering chunks left the tool call pending indefinitely — no deadline was
  left to fire, and the host's own cancellation was the only way out. Each body
  chunk is now read against the request's abort signal, and the stream is
  cancelled on every way out of the read, whether the byte cap, the deadline or a
  broken transfer ended it.

  Failures say which half of the exchange was lost. A body that stalls is a
  timeout that names the body rather than a host that never replied, and a
  transfer cut short folds into `unreachable` with the transport's reason instead
  of escaping as an untyped error. The README and SPEC state that one budget
  covers the whole request.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.2.1 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the client test monolith is split into read, write and error ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  domains with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-18)

### 🚀 Features

- Initial release: canonical DSH tools over a LightRAG knowledge base. ([f8b0b97](https://github.com/xarleyn/dsh-plugins/commit/f8b0b97))

  A LightRAG server indexes a corpus into a graph and answers retrieval questions
  over it, and until now the only way to reach one from an agent was a
  third-party MCP bridge holding an API key to everything the stand has indexed.
  This plugin speaks the server's HTTP API directly and registers three read
  tools: `dsh_lightrag_query` (answer plus the references it was built from),
  `dsh_lightrag_documents` (what the index holds, with each document's ingestion
  status and failure reason) and `dsh_lightrag_status` (server health, versions
  and per-status counts — the call that separates "server down" from "nothing
  ingested yet").

  The model never receives an HTTP client. `endpoint` must be a bare http(s)
  origin, so a mistyped configuration cannot send the API key or a request to
  another host; the key travels as `X-API-Key` and never reaches a tool result or
  a log record; responses are read through a byte cap and requests through a
  wall-clock budget. Failures surface as one typed error with a stable code and
  the one-line operator action that usually resolves it — `unreachable`,
  `unauthorized`, `not-found`, `rate-limited`, `server-error`, `timeout`,
  `bad-response`, `too-large`, `invalid-argument`, `disabled`.

  The three write tools — `dsh_lightrag_insert`, `dsh_lightrag_scan`,
  `dsh_lightrag_delete` — are registered only when `writes.enabled` is true. The
  default is off: a deployment that runs agents read-only must not have a write
  tool whose name a tool allow-list can carry, because an allow-list entry naming
  a tool that never registers refuses the attestation. `dsh_lightrag_delete`
  removes the index entry and its extracted graph data while passing
  `delete_file: false`, so the operator's source file survives a mistaken delete
  and a later scan can restore the document.

  Verified against a live LightRAG 1.5.7 instance (API 0344): status, listing and
  an answered query with a reference, plus the write path end to end.

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 (unreleased)

### Features

- LightRAG knowledge-base tools for DeepSeek Harness agents: `dsh_lightrag_query`,
  `dsh_lightrag_documents` and `dsh_lightrag_status` answer questions from a
  LightRAG graph-RAG index, list what it holds and report its health, without
  giving the model an HTTP client.
- Write tools `dsh_lightrag_insert`, `dsh_lightrag_scan` and
  `dsh_lightrag_delete`, registered only when `writes.enabled` is true.
- One configured origin per deployment, per-request time budget, response byte
  caps and typed error codes with operator hints.
