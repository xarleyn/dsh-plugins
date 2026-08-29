# dsh-prompt-firewall

Prompt hygiene, observability, and policy middleware for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It inspects
the final structured system-prompt assembly, audits every section, and can
remove explicitly denied sections without changing user messages, tool calls,
contexts, variables, or allowed section objects.

This plugin is a policy and observability layer, not a security sandbox.

## Features

- `off`, `audit`, `blocklist`, and `allowlist` modes;
- exact, prefix, and glob rules with deterministic priority;
- explicit and verified core-namespace protection;
- `clean`, `strict`, and `audit-only` presets;
- approximate token counts (`ceil(chars / 4)`);
- bounded in-memory audit history and known-section tracking;
- label-free aggregate metrics with stable Prometheus/OTel-compatible names;
- live `prompt-firewall` settings namespace with persistent per-section actions;
- native `Settings → Plugins → Prompt Firewall` card;
- live Prompt Inspector with section decisions, sizes, reasons, and safe previews;
- one-click Allow, Block, Protect, and Clear actions with revision fencing;
- previews disabled by default;
- fail-open behavior on internal firewall errors;
- official `system-prompt/assemble` Cordis middleware integration.

The default configuration is deliberately neutral: blocklist mode with no
blocked rules. Select `preset: clean` to remove the known noisy plugin sections
listed in the project specification.

## Settings UI

The package ships both Host and browser halves. In a DSH web client it adds a
Prompt Firewall card to the standard Plugins settings page. The card provides:

- live mode, preset, core-protection, audit, preview, history, and metrics settings;
- an exact/prefix/glob rule editor;
- last-request totals and estimated token savings;
- a periodically refreshed section inspector with per-section policy actions.

Token values are explicitly marked as estimates. Section text is not exposed
unless `audit.includePreview` is enabled, and then only the configured prefix
is retained in memory and shown.

## Install and configure

```sh
dsh plugin --profile web add @yadsh/dsh-prompt-firewall
```

The bundle patch adds the following runtime row; override its configuration in
the profile when needed:

```yaml
- name: dsh-prompt-firewall
  config:
    mode: blocklist
    preset: clean
    blockedSections:
      - plugin:another-noisy-plugin
    blockedPrefixes:
      - announcement:
```

Audit without changing the prompt:

```yaml
- name: dsh-prompt-firewall
  config:
    mode: audit
    audit:
      enabled: true
      logAllowed: true
      includePreview: false
```

Strict allowlist:

```yaml
- name: dsh-prompt-firewall
  config:
    mode: allowlist
    allowedSections:
      - plugin:my-important-plugin
    protectCoreSections: true
```

Rule priority is: protected, exact allow, exact block, prefix allow, prefix
block, glob allow, glob block, then the mode/default policy.

## Service API

When mounted, the plugin exposes `ctx.promptFirewall`:

```ts
const lastAudit = ctx.promptFirewall.inspectLast()
const auditHistory = ctx.promptFirewall.inspectHistory()
const knownSections = ctx.promptFirewall.getKnownSections()
const metrics = ctx.promptFirewall.getMetrics()
const decision = ctx.promptFirewall.evaluateSection({
  name: 'plugin:example',
  text: 'Example instructions.',
})

await ctx.promptFirewall.setSectionPolicy('plugin:example', 'block')
```

The collector exposes these aggregate counters without section-name labels:

```text
dsh_prompt_firewall_requests_total
dsh_prompt_firewall_sections_total
dsh_prompt_firewall_sections_blocked_total
dsh_prompt_firewall_chars_removed_total
dsh_prompt_firewall_estimated_tokens_removed_total
```

Audit previews are never retained or logged unless `audit.includePreview` is
explicitly enabled. Even then, only the first `audit.previewChars` characters
are retained.

When a DSH settings provider is mounted, configuration is registered under the
`prompt-firewall` namespace and changes are applied live. `setSectionPolicy()`
accepts `allow`, `block`, `protect`, or `clear`; an optional settings revision
can be supplied to reject stale UI writes. Without a settings provider, reads
and filtering still work, while mutation fails with an explicit error.

## Ordering and complete prompts

Cordis currently exposes registration order and `prepend`, not numeric listener
priorities. The plugin prepends a wrapper and filters after `next()` resolves,
so normally it sees changes from downstream assembly listeners. A later plugin
that also prepends a wrapper can still become outermost; composition authors
should avoid relying on adversarial load order.

Current DSH assemblies do not expose the original `complete` flag to waterfall
listeners. DSH restores the effective complete section after the waterfall, so
the firewall cannot override or decompose a complete replacement and its exact
prompt semantics remain intact.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```
