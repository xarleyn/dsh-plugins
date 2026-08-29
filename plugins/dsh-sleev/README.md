# dsh-sleev

[![CI](https://github.com/xarleyn/dsh-sleev/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-sleev/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-sleev.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

Early [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
integration for observing provider routes that pass through the external Sleev
context-optimization gateway.

The current M1 observer does not rewrite prompts, implement compaction, or route
traffic by itself. Routing is configured as a normal
`@deepseek-ai/dsh-llm-pi-ai` provider profile; the Host observes matching route
aliases at the `llm/stream` boundary, and the browser half exposes its observer
settings in the standard Plugins page.

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-sleev
```

Or install the latest source directly with a GitHub package specifier:

```bash
dsh plugin --profile web add github:xarleyn/dsh-sleev
```

GitHub dependencies are built from source, so pnpm may ask you to approve this
package's `prepare` script. The npm package is recommended when you do not want
install-time build permission.

If you manage a profile package manually, the corresponding dependency commands
are `pnpm add @yadsh/dsh-sleev` and `pnpm add github:xarleyn/dsh-sleev`.

Remove the plugin with:

```bash
dsh plugin --profile web remove @yadsh/dsh-sleev
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up a newly
installed plugin or a newly added browser client.

## Current behavior

- observes exact routes and/or prefixes (default prefix: `sleev-`);
- classifies agent, compaction, session-title, and one-shot calls;
- yields every stream chunk unchanged;
- records provider usage and effective input token volume;
- retains a bounded secret-free in-memory history;
- logs one structured completion record per observed call;
- exposes observer matching, retention, and logging settings in the Web UI.

The observer never stores prompts, request headers, credentials, or secret
values. Direct routes that do not match the configured Sleev aliases remain
unobserved.

## Plugin settings card

Open **Settings → Plugins → Plugin configuration → Sleev** to edit:

- exact observed provider aliases;
- observed provider-name prefixes;
- the in-memory recent-call limit;
- structured telemetry logging (`off`, `info`, or `debug`).

Edits are staged until **Save**, which is enabled only when the form has actual
changes. Each overridden field can be reset to its composition default
individually, and the card marks unsaved changes. Saved values apply to the next
matching call without a Host restart. These settings decide what the plugin
observes; model endpoints and Sleev routing headers still belong under
`llm-pi-ai.providers` in DSH model settings.

## Configure a Sleev route

Merge a provider route into `$DSH_HOME/settings.yaml` under
`llm-pi-ai.providers`. DSH resolves the credential reference; never place the
literal API key in the route configuration.

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

Use `sleev-provider` instead of `sleev-base-url` for a provider known to Sleev;
do not combine both headers on one route. See
[the sample settings](docs/sample-settings.yml) for both forms.

Sleev does not currently document a native DeepSeek Harness identifier. The
sample's `sleev-harness: pi` value is an explicit experimental compatibility
choice, not a promise of first-party support.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`;
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`;
- Cordis `^4.0.1`;
- a configured and running Sleev gateway for routed model calls.

## Development

```bash
pnpm install
pnpm check
```

Build and link the checkout into a Web profile:

```bash
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
```

Run the account-backed NeuralDeep smoke separately when credentials and the
local gateway are available:

```bash
pnpm smoke:neuraldeep
```

The live provider smoke is deliberately not part of required CI because it
depends on credentials, a local gateway, and an external provider. See the
[development guide](docs/development.md) for setup and retry behavior.

## Compatibility

The complete DSH → llm-pi-ai → Sleev → NeuralDeep streaming path has passed
ordinary completion, usage, tool-call, and tool-result checks with DeepSeek
Harness `0.1.1-rc.2`, Sleev `1.7.7`, and NeuralDeep `gpt-oss-20b`.

This establishes transport compatibility, not token savings. The tiny test
prompt exposed Sleev's fixed instruction overhead; a long tool-heavy session is
still needed for a meaningful compression benchmark. See the
[compatibility notes](docs/compatibility.md) for exact evidence.

## Releases

Pushing a `v`-prefixed SemVer tag starts the
[Release workflow](.github/workflows/release.yml). It verifies the exact tag,
runs the quality gate, applies the tag version to the packed manifest, tests a
clean DSH profile install, creates a checksum, and publishes a GitHub Release.
The same workflow can be started manually for an existing tag to optionally
publish the tested artifact to npm through trusted publishing.

Prerelease tags use the npm `next` dist-tag; stable tags use `latest`. npm
publishing is disabled for tag pushes and by default for manual runs. Enabling
it requires an `npm` GitHub environment plus an npm trusted-publisher
configuration for `release.yml`.
