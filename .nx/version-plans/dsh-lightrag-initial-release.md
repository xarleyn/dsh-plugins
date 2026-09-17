---
"@yadsh/dsh-lightrag": minor
---

Initial release: canonical DSH tools over a LightRAG knowledge base.

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
