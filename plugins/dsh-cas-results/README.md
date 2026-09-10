# dsh-cas-results

DeepSeek Harness plugin that keeps bulky tool output out of the model context
without throwing it away: large tool results are stored once in a local
content-addressed store keyed by SHA-256, the session keeps only a bounded
deterministic preview plus a stable reference, and the agent can retrieve or
search the original on demand.

```text
[dsh-cas-results: 2871934B html → 4096B preview; sha256=ac7819…e029; use dsh_cas_retrieve]
type: text/html

HTML document
title: Example
…

Full content:
dsh_cas_retrieve(ref="sha256:ac7819…e029")
```

## Features

- **Ingestion-time offloading** — successful tool results are inspected before
  they enter model history; oversized string fields are replaced with bounded
  previews while the canonical value stays intact.
- **Content-addressed storage** — payloads are stored by SHA-256 over the
  logical bytes; identical content is stored once across tools, turns, and
  sessions (gzip storage codec is optional and never affects identity).
- **Recursive JSON scanning** — `stdout`, `html`, base64 blobs: every string
  field over its threshold becomes an independent CAS object; the value's
  shape is preserved.
- **Base64/binary awareness** — data URIs and confident raw base64 payloads
  are decoded, deduplicated as binary, and re-encoded on retrieval. Detection
  is deliberately conservative (SPEC §11).
- **Deterministic previews** — head/tail for text, keep-patterns for logs,
  title plus text-only body for HTML, and a payload-free marker for binary.
  No LLM, no clocks, no locale-dependent output.
- **Retrieval tools** — `dsh_cas_retrieve` (bounded, paginated, utf8/base64/
  hex), `dsh_cas_search` (substring with context lines), `dsh_cas_info`,
  `dsh_cas_stats`, and an opt-in `dsh_cas_gc`.
- **Fail-open safety** — storage failures, corrupt blobs, and disabled config
  always leave the original tool result untouched; tool errors are never
  transformed by default.
- **Bounded storage** — TTL plus quota garbage collection with oldest-access
  eviction and orphan staging cleanup.
- **Zero core changes** — the plugin rides the public `tools/post-execute`
  seam and the public tool registry; DSH stays untouched.

## Install

```bash
dsh plugin add @yadsh/dsh-cas-results
```

Or from a checkout of this monorepo, build the package and add it from the
packed tarball.

## Configuration

Configuration lives in the plugin's composition entry (`cordis.patch.yml`
override layers or profile patches). All fields are optional.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch; `false` passes every result through. |
| `storeDir` | `string` | `""` | Store root; empty resolves to `<$DSH_HOME>/storages/dsh-cas-results`. |
| `thresholds.textBytes` | `number` | `16384` | Offload threshold for generic text in bytes. |
| `thresholds.htmlBytes` | `number` | `8192` | Offload threshold for HTML in bytes. |
| `thresholds.logBytes` | `number` | `16384` | Offload threshold for log-like output in bytes. |
| `preview.maxChars` | `number` | `4096` | Character budget for preview bodies. |
| `preview.keepHeadLines` | `number` | `20` | Head lines kept in text/log previews. |
| `preview.keepTailLines` | `number` | `30` | Tail lines kept in text/log previews. |
| `preview.keepPatterns` | `string[]` | error, warn, … | Case-insensitive substrings kept from the middle of logs. |
| `base64.enabled` | `boolean` | `true` | Decode and deduplicate base64/binary payloads. |
| `base64.minChars` | `number` | `8192` | Minimum candidate length before detection runs. |
| `base64.requireStrongDetection` | `boolean` | `true` | Require data-URI context or binary evidence for raw candidates. |
| `storage.compression` | `"none" \| "gzip" \| "auto"` | `"auto"` | On-disk codec; identity is always computed over logical bytes. |
| `storage.maxBytes` | `number` | `10737418240` | Logical-byte quota enforced by GC. |
| `retrieval.defaultBytes` | `number` | `32768` | Default chunk size for `dsh_cas_retrieve`. |
| `retrieval.maxBytes` | `number` | `262144` | Hard upper bound for one retrieval chunk. |
| `gc.enabled` | `boolean` | `true` | Run background garbage collection. |
| `gc.intervalMs` | `number` | `3600000` | GC interval in milliseconds. |
| `gc.ttlMs` | `number` | `2592000000` | Objects untouched for this long become eligible. |
| `gc.minAgeMs` | `number` | `86400000` | Routine GC never deletes objects younger than this. |
| `includeErrors` | `boolean` | `false` | Also preview oversized text inside failed results. |
| `excludeTools` | `string[]` | `["write", "edit", "str_replace_editor"]` | Tools whose results are never transformed. |
| `tools.<name>.thresholdBytes` | `number` | — | Per-tool offload threshold override. |
| `tools.<name>.preview` | `"auto" \| "text" \| "log" \| "html"` | `"auto"` | Forced preview style for the tool. |
| `tools.<name>.base64` | `boolean` | — | Per-tool base64 on/off override. |
| `tools.<name>.disabled` | `boolean` | — | Skip transformation for this tool entirely. |
| `exposeGcTool` | `boolean` | `false` | Register the model-facing `dsh_cas_gc` tool. |

## Compatibility

- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0` (host-service plugin; no client UI).
- Node.js `^22.19.0 || >=24.0.0`.
- See [compatibility.json](./compatibility.json) for the machine-readable
  contract.

## Development

```bash
pnpm nx run dsh-cas-results:lint
pnpm nx run dsh-cas-results:typecheck
pnpm nx run dsh-cas-results:test
pnpm nx run dsh-cas-results:build
pnpm nx run dsh-cas-results:verify
```

The plugin contract and its verifiable guarantees live in
[SPEC.md](./SPEC.md).

## Credits

dsh-cas-results is inspired by
[dsh-funnel](https://github.com/YuanyuanMa03/dsh-funnel)
by [YuanyuanMa03](https://github.com/YuanyuanMa03).

dsh-funnel pioneered the ingestion-time tool-result curation approach used as
the conceptual and implementation starting point for this plugin. See
[NOTICE.md](./NOTICE.md) for attribution details.

## License

[MIT](./LICENSE)
