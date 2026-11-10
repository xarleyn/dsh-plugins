# dsh-tool-toon — specification

## Product contract

An optional host plugin converts successful JSON text blocks to fenced TOON
before they enter model context. It uses the official `@toon-format/toon`
encoder and strict decoder. No model, network call or summarization is involved.
JSON objects and arrays retain their data; strings, prose and errors pass through.

## Transformation contract

- Await the downstream `tools/post-execute` decision once before processing.
- Preserve blocks, additional contexts, errors, block decisions and pending
  value replacements. Never recreate raw data from `result.value` after another
  processor has replaced content. Never mutate inputs.
- Skip nested/code-mode executions (`exec.parent` is set).
- Convert only complete JSON object/array text blocks inside configured byte
  bounds. Skip unsafe integer values, negative zero, non-finite numbers and
  nesting deeper than 64. Verify semantic round-trip before replacing text.
- Use a `toon` code fence longer than any backtick run in the encoded data.
  Include the fence in the savings comparison against both original text and
  compact JSON; require both configured savings thresholds.
- Savings are UTF-8 bytes, **not a guarantee of provider token savings**.
  No values, rows or fields are discarded. No tool input/schema changes.
- Conversion failures preserve the accepted downstream decision. Downstream
  exceptions propagate. Existing TOON and non-text blocks pass through.

## Lifecycle and composition

Installing the plugin opts in; `enabled: false` bypasses it. Defaults:
`minBytes: 512`, `maxBytes: 262144`, `minSavingsBytes: 96`,
`minSavingsRatio: 0.15`, `excludeTools: []` (exact names). Numeric bounds clamp.
Settings namespace: `dsh-tool-toon`. Required feature: `tools/post-execute`.
The returned disposer unregisters the listener and closes the logger.
Register this plugin before CAS/offload/JEV when TOON should run after their
projections unwind. Other orders remain safe but may affect classification or
compression. Provider token counts and live Jira acceptance need separate runs.

## Acceptance

Config boundaries; uniform/nested tables and escaping; round-trip equality;
small/expanded/invalid/unsafe/oversized JSON bypass; mixed blocks; downstream
decision branches; additional-context identity; failure propagation; canonical
value identity; lifecycle symmetry; built package and tarball checks.
`pnpm check` runs lint, typecheck, tests, build and package verification.
