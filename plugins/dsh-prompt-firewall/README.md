# dsh-prompt-firewall

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-prompt-firewall.svg)](https://www.npmjs.com/package/@yadsh/dsh-prompt-firewall)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-prompt-firewall.svg)](https://www.npmjs.com/package/@yadsh/dsh-prompt-firewall)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-prompt-firewall.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Prompt hygiene, observability, and policy middleware for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-prompt-firewall` inspects the final structured system-prompt assembly, audits every section, and can remove explicitly denied sections without changing user messages, tool calls, contexts, variables, or allowed section objects. It is a policy and observability layer, not a security sandbox.

[Specification](SPEC_%20dsh-prompt-firewall.md)

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-prompt-firewall
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-prompt-firewall
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## What works now

- `off`, `audit`, `blocklist`, and `allowlist` modes;
- exact, prefix, and glob rules with deterministic priority;
- explicit and verified protection for core namespaces;
- `clean`, `strict`, and `audit-only` presets;
- approximate token counts using `ceil(chars / 4)`;
- bounded in-memory audit history and known-section tracking;
- label-free aggregate metrics with stable Prometheus/OTel-compatible names;
- live settings with persistent per-section actions and revision fencing;
- a Prompt Inspector with decisions, sizes, reasons, and safe previews;
- fail-open behavior on internal firewall errors;
- integration through the official `system-prompt/assemble` Cordis middleware.

The default configuration is deliberately neutral: blocklist mode with no blocked rules. Select `preset: clean` to remove the known noisy plugin sections listed in the specification.

## Settings UI

The browser half adds a **Prompt Firewall** card under **Settings → Plugins**. It provides:

- live mode, preset, core-protection, audit, preview, history, and metrics settings;
- an exact, prefix, and glob rule editor;
- last-request totals and estimated token savings;
- a periodically refreshed section inspector;
- one-click Allow, Block, Protect, and Clear actions.

Token values are estimates. Section text is hidden unless `audit.includePreview` is enabled; even then, only the configured prefix is retained in memory and displayed.

## Configuration

The bundle inserts the `dsh-prompt-firewall` Cordis row. Override its configuration in the profile patch when needed:

```yaml
- id: dsh-prompt-firewall
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
- id: dsh-prompt-firewall
  config:
    mode: audit
    audit:
      enabled: true
      logAllowed: true
      includePreview: false
```

Strict allowlist:

```yaml
- id: dsh-prompt-firewall
  config:
    mode: allowlist
    allowedSections:
      - plugin:my-important-plugin
    protectCoreSections: true
```

Rule priority is protected, exact allow, exact block, prefix allow, prefix block, glob allow, glob block, then the mode's default policy.

## Service API

When mounted, the plugin exposes `ctx.promptFirewall`:

```ts
const lastAudit = ctx.promptFirewall.inspectLast();
const auditHistory = ctx.promptFirewall.inspectHistory();
const knownSections = ctx.promptFirewall.getKnownSections();
const metrics = ctx.promptFirewall.getMetrics();
const decision = ctx.promptFirewall.evaluateSection({
  name: "plugin:example",
  text: "Example instructions.",
});

await ctx.promptFirewall.setSectionPolicy("plugin:example", "block");
```

The collector exposes aggregate counters without section-name labels:

```text
dsh_prompt_firewall_requests_total
dsh_prompt_firewall_sections_total
dsh_prompt_firewall_sections_blocked_total
dsh_prompt_firewall_chars_removed_total
dsh_prompt_firewall_estimated_tokens_removed_total
```

When the DSH settings provider is mounted, configuration is registered under `prompt-firewall` and changes apply live. `setSectionPolicy()` accepts `allow`, `block`, `protect`, or `clear`; callers can supply a settings revision to reject stale writes. Without a settings provider, inspection and filtering still work, while mutation fails explicitly.

## Design boundaries

- Audit previews are never retained or logged unless `audit.includePreview` is explicitly enabled.
- The plugin prepends a wrapper and filters after `next()` resolves, so it normally sees downstream assembly changes; composition authors should still avoid relying on adversarial load order.
- DSH restores effective complete sections after the waterfall. The firewall therefore does not override or decompose a complete replacement.
- The plugin does not modify user messages, tool calls, contexts, or variables.

## Requirements

- Node.js 20 or newer
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Cordis `^4.0.1`

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-prompt-firewall lint
pnpm --filter @yadsh/dsh-prompt-firewall typecheck
pnpm --filter @yadsh/dsh-prompt-firewall test
pnpm --filter @yadsh/dsh-prompt-firewall build
pnpm --filter @yadsh/dsh-prompt-firewall verify
```

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Contributing

Issues and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) and run the package checks before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
