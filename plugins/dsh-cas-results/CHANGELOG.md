## 0.1.1 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  compatibility contract and README requirements move to
  `>=0.1.5-rc.2 <0.2.0`.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-10)

### 🚀 Features

- Add the content-addressed tool-result store: bulky successful tool outputs are ([7777608](https://github.com/xarleyn/dsh-plugins/commit/7777608))
  stored once by SHA-256, the session keeps a bounded deterministic preview plus
  a stable reference, and `dsh_cas_retrieve` / `dsh_cas_search` / `dsh_cas_info`
  / `dsh_cas_stats` provide bounded retrieval, search, metadata, and aggregate
  statistics with TTL and quota garbage collection.

### ❤️ Thank You

- xarleyn @xarleyn