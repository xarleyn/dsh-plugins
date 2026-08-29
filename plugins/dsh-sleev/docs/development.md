# Development and local smoke testing

## Prerequisites

- Node.js 22.19+ or 24+
- pnpm 11
- DeepSeek Harness 0.1.1-rc.2
- Sleev CLI 1.7.7 for a real gateway test

Install and verify Sleev without starting an account flow:

```powershell
npm install --global sleev@1.7.7
sleev --version
sleev gateway status
```

Account and machine setup are interactive and deliberately remain a user
action:

```powershell
sleev auth login
sleev setup
sleev gateway status
```

The default local gateway address is `http://127.0.0.1:17321`; an
OpenAI-compatible DSH route uses `http://127.0.0.1:17321/v1` as its base URL.

## DSH profile

Build before adding or restarting the profile:

```powershell
pnpm check
dsh plugin --profile web add /absolute/path/to/dsh-sleev
```

The current DSH web bundle disables shared-module HMR. Changes to this package
therefore require a host restart, especially after adding or changing the
package's `dsh.client` manifest. Changes under the `llm-pi-ai` section of
`$DSH_HOME/settings.yaml` are independently hot-reloaded by DSH settings.

After restarting, open **Settings → Plugins → Plugin configuration → Sleev**.
The card edits the `sleev` namespace in `$DSH_HOME/settings.yaml`: exact routes,
route prefixes, recent-call retention, and logging level. Values are staged
until Save and then read through by the Host on the next matching request. The
card does not edit `llm-pi-ai` provider endpoints or Sleev routing headers.

## Compatibility caveat

Sleev currently documents harness ids for several first-party integrations but
not DeepSeek Harness. The sample uses `sleev-harness: pi` because the supported
DSH adapter is `llm-pi-ai`; treat it as an experimental compatibility value.
Keep it easy to override, and verify tools, streaming, and usage on every Sleev
upgrade until Sleev publishes a native DSH identifier.

Only record a version pair as compatible after a configured account passes a
real request with tools and a provider `usage` chunk; the matrix records the
first version pair that met that bar.

## NeuralDeep compatibility smoke

With `NEURALDEEP_API_KEY` available in the environment, run:

```powershell
pnpm smoke:neuraldeep
```

The script compares a direct and Sleev-routed short prompt, then performs a
tool-call and tool-result continuation through Sleev. It requires provider
usage on every successful call and exits non-zero if stream/tool semantics are
lost. Normalized provider errors are retried up to three times because the free
NeuralDeep route can be transiently unavailable.

The first verified run is recorded in [compatibility.md](compatibility.md).
