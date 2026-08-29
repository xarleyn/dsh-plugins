# dsh-sleev

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-sleev.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Sleev routing observability for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-sleev` observes provider routes that pass through the external Sleev context-optimization gateway. The current observer does not rewrite prompts, implement compaction, or route traffic itself: routing remains a normal `@deepseek-ai/dsh-llm-pi-ai` provider configuration.

[简体中文](README.zh-CN.md) · [Specification](dsh-sleev-spec-v0.1.md) · [Development guide](docs/development.md) · [Compatibility notes](docs/compatibility.md)

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-sleev
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-sleev
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## What works now

- exact route and prefix matching, with `sleev-` as the default prefix;
- classification of agent, compaction, session-title, and one-shot calls;
- pass-through streaming that yields every chunk unchanged;
- provider usage and effective input-token accounting;
- bounded, secret-free in-memory call history;
- one structured completion record per observed call;
- live observer matching, retention, and logging settings in the Web UI.

The observer never stores prompts, request headers, credentials, or secret values. Direct routes that do not match the configured Sleev aliases remain unobserved.

## Settings UI

Open **Settings → Plugins → Plugin Configuration → Sleev** to edit:

- exact observed provider aliases;
- observed provider-name prefixes;
- the recent-call history limit;
- structured telemetry logging at `off`, `info`, or `debug`.

Edits are staged until **Save**. The card marks unsaved changes and lets each overridden field be reset to its composition default. Saved values apply to the next matching call without a host restart.

These settings decide what the plugin observes. Model endpoints and Sleev routing headers still belong under `llm-pi-ai.providers` in DSH model settings.

## Configure a Sleev route

Merge a provider route into `$DSH_HOME/settings.yaml` under `llm-pi-ai.providers`. DSH resolves the credential reference; never place a literal API key in the route configuration.

```yaml
llm-pi-ai:
  providers:
    sleev-neuraldeep:
      displayName: Sleev / neuraldeep
      apiKeyEnv: NEURALDEEP_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:17321/v1
      headers:
        sleev-base-url: https://api.neuraldeep.ru/v1
        sleev-harness: pi
      models:
        - id: gpt-oss-20b
          name: GPT OSS 20B via Sleev
```

Use `sleev-provider` instead of `sleev-base-url` for a provider known to Sleev; do not combine the two headers on one route. The [sample settings](docs/sample-settings.yml) show both forms.

Sleev does not currently document a native DeepSeek Harness identifier. The sample's `sleev-harness: pi` is an explicit experimental compatibility choice, not a promise of first-party support.

## Compatibility

The complete DSH → llm-pi-ai → Sleev → NeuralDeep streaming path has passed ordinary completion, usage, tool-call, and tool-result checks with DeepSeek Harness `0.1.1-rc.2`, Sleev `1.7.7`, and NeuralDeep `gpt-oss-20b`.

This establishes transport compatibility, not token savings. The small validation prompt exposed Sleev's fixed instruction overhead; a long, tool-heavy session is still required for a meaningful compression benchmark. See the [compatibility notes](docs/compatibility.md) for the exact evidence.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Cordis `^4.0.1`
- a configured and running Sleev gateway for routed model calls

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-sleev check
```

Build and link the checkout into a Web profile:

```bash
pnpm --filter @yadsh/dsh-sleev build
dsh plugin --profile web add ./plugins/dsh-sleev
dsh --profile web --dump-config
```

Run the account-backed NeuralDeep smoke separately when credentials and the local gateway are available:

```bash
pnpm --filter @yadsh/dsh-sleev smoke:neuraldeep
```

The live provider smoke is intentionally excluded from required CI because it depends on credentials, a local gateway, and an external provider.

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Contributing

Issues and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) and run the package check before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
