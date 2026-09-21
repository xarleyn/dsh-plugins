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
