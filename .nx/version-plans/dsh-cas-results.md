---
"@yadsh/dsh-cas-results": minor
---

Add the content-addressed tool-result store: bulky successful tool outputs are
stored once by SHA-256, the session keeps a bounded deterministic preview plus
a stable reference, and `dsh_cas_retrieve` / `dsh_cas_search` / `dsh_cas_info`
/ `dsh_cas_stats` provide bounded retrieval, search, metadata, and aggregate
statistics with TTL and quota garbage collection.
