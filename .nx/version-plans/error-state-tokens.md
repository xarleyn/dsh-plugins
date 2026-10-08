---
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-documents": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-openviking-memory": patch
"@yadsh/dsh-plugin-log-ui": patch
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-qa-surface": patch
"@yadsh/dsh-session-scope": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-ui-repair": patch
"@yadsh/dsh-web-fetch-authenticated": patch
---

A refusal block reads as a refusal again, and a token the Host never declares
cannot be written down unnoticed.

Unknown `var(--dsw-…)` is not a missing colour: the substitution yields the
guaranteed-invalid value, so the browser drops the whole declaration at
computed-value time and says nothing. `--dsw-alias-bg-error` and
`--dsw-alias-label-error` are named by no theme sheet — the error ramp is
`--dsw-alias-state-error-primary` — so every block of refusal text written with
them lost its fill and its ink together and rendered as ordinary small text,
which is how issue #717 looked on the Memory tab of a stand with no access to
the service. The same mechanic had already cost `dsh-sleev` its focus and
invalid borders (`--dsw-alias-border-brand`, `--dsw-alias-border-error`) and
`dsh-session-scope` its chip fill (`--dsw-alias-fill-tsp-secondary`).

Text and borders now take `--dsw-alias-state-error-primary` with a `#b3261e`
fallback. The theme declares no error *surface* alias — `state-success` and
`state-warn` have a tint, `state-error` does not — so a block mixes the state
token the way the Host's own danger control does,
`color-mix(in srgb, … 8%, transparent)`, and keeps its soft red in both themes.
Three names that only ever survived behind a fallback are retired where a live
token exists (`--dsw-alias-bg-elevated` → `--dsw-alias-button-elevated-fill`,
`--dsw-alias-label-inverse` → `--dsw-alias-label-primary-foreground`), and
`--dsw-font-family-mono`, for which the theme offers no alias at all, becomes
the `ui-monospace` stack the other bundles already write. No computed value
changes except where a dead name had been silently winning.

`pnpm verify:tokens` (`scripts/verify-design-tokens.mjs`) is the class turned
into a gate: it collects every `--dsw-*` name substituted under any package's
`src/` and refuses one the installed `@deepseek-ai/dsh-client-ui-theme` does not
declare — a dead name behind a fallback included, because the fallback paints a
colour the Host never chose. The vocabulary comes from the pinned package rather
than a hand-kept list, so the check needs no harness checkout and reads the same
version the plugins build against; where the theme cannot be found the gate
reports that instead of passing. `dsh-plugin-log-ui`'s own bundle pin flips from
requiring `--dsw-alias-bg-error` to forbidding the dead error names.
