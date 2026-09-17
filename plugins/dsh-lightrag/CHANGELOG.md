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
