# dsh-doc-impact

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-doc-impact.svg)](https://www.npmjs.com/package/@yadsh/dsh-doc-impact)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-doc-impact.svg)](https://www.npmjs.com/package/@yadsh/dsh-doc-impact)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-doc-impact.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deterministic documentation-impact enforcement for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-doc-impact` links code and documentation through a declarative impact graph. When an agent changes files, the plugin compares the workspace with the turn baseline and steers the agent to review or update every affected document before the turn closes.

[Specification](SPEC_%20dsh-doc-impact.md) · [Release notes](RELEASING.md)

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-doc-impact
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-doc-impact
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## How it works

```text
packages/auth/src/session.ts changed

→ docs/authentication.md
→ docs/security/session-lifecycle.md
```

1. **Baseline** — on the first step of a turn, the plugin records `HEAD` and the content hashes of already-dirty files. Pre-existing user changes are never attributed to the agent.
2. **Stop check** — on `agent/turn-stopping`, it compares the workspace with that baseline, including commits made during the turn, and matches the delta against project rules.
3. **Steer** — unresolved impacts produce one grouped reminder and another model step in which the agent can review or update the affected documents.
4. **Resolve** — strict modes require `doc_impact_resolve` with `reviewed-current`, `updated`, or `not-applicable`; the last status requires a reason.
5. **Loop protection** — reminders are fingerprinted and bounded by `maxReminderRounds`, with configurable fail-open or fail-closed behavior.

## Configuration

Create `.dsh/doc-impact.yml` in the workspace the agent operates on:

```yaml
version: 1

defaults:
  mode: remind # remind | require-review | require-resolution | require-update
  scope: turn # turn | session
  changeDetection: auto # auto | git | filesystem

rules:
  - id: auth-docs
    description: Authentication behavior documentation
    code:
      include:
        - packages/auth/**
        - packages/server/src/auth/**
      exclude:
        - "**/*.test.ts"
    docs:
      - docs/authentication.md
    direction: code-to-docs # code-to-docs | docs-to-code | bidirectional
    relation: documents # documents | specification | synchronized | related
    mode: require-resolution

  - id: configuration-contract
    code: [packages/config/**]
    docs: [docs/configuration.md]
    direction: bidirectional
    relation: specification
```

Personal overrides belong in `.dsh/doc-impact.local.yml`, which should be ignored by Git:

```yaml
disabledRules:
  - legacy-docs
```

The bundle inserts the `doc-impact` Cordis row. Override its defaults in the profile patch when needed:

```yaml
- id: doc-impact
  config:
    enabled: true
    configFile: .dsh/doc-impact.yml
    defaults:
      mode: remind
    safety:
      maxReminderRounds: 2
      onLimit: allow # allow | warn | error
    changeDetection:
      maxSnapshotFiles: 10000
    debug: false
```

## Commands and tools

| Interface                      | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `/doc-impact`                  | Show pending and resolved impacts               |
| `/doc-impact check`            | Recompute impacts immediately                   |
| `/doc-impact explain <ruleId>` | Explain a rule and whether it was triggered     |
| `/doc-impact changed`          | List files attributed to the current agent turn |
| `doc_impact_resolve`           | Resolve an impact explicitly in strict modes    |
| `doc_impact_status`            | Read the current impact status                  |

## Settings UI

The browser half adds a **Doc Impact** card under **Settings → Plugins → Plugin Configuration**. It provides staged edits, Save and Discard actions, an unsaved-state badge, validation, and per-field reset to composition defaults.

Editable fields include `enabled`, `configFile`, default `mode`, `maxReminderRounds`, `onLimit`, `maxSnapshotFiles`, and `debug`. Saved settings apply to the merged runtime configuration without a host restart.

## What works now

- code-to-docs, docs-to-code, and bidirectional rules;
- include and exclude globs;
- Git and filesystem baseline detectors;
- reminder aggregation and `agent/turn-stopping` continuation;
- `remind`, `require-review`, `require-resolution`, and `require-update` modes;
- explicit resolution tools, commands, and loop protection;
- unit and integration coverage, including real Git repositories.

## Requirements

- Node.js 20 or newer
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Cordis `^4.0.1`

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-doc-impact check
```

The core under `src/config`, `src/graph`, `src/changes`, and `src/engine` is DSH-independent. Only `src/dsh` imports `@deepseek-ai` packages.

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Contributing

Issues and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) and run the package check before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
