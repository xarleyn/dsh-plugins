# @yadsh DeepSeek Harness plugins

A collection of installable DeepSeek Harness (DSH) plugins. They add session
workspace scoping, documentation-impact tracking, prompt-injection and firewall
controls, draft sessions, localization overrides, KV persistence, git
provenance, QA surfaces, and developer tooling to a harness profile — each one
published as its own npm package and installable on its own.

DSH resolves plugins as npm packages, so install only what you need:

```bash
dsh plugin --profile <profile> add @yadsh/dsh-session-scope
```

Every published package is listed in the generated
[`plugins.json`](plugins.json) catalog, which maps each npm name to its source
directory here for marketplaces, indexes, and crawlers. Repositories and
packages carry the [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub
topic and the same canonical keywords (`deepseek-harness`, `dsh`, `dsh-plugin`,
`cordis`).

## Repository layout

`@yadsh` (Yet Another DSH) is a pnpm + Nx monorepo for independently versioned
DeepSeek Harness plugins. Each directory under `plugins/` is its own public npm
package; shared runtime libraries and workspace tooling live under `packages/`.

## Packages

| Directory | npm package | Purpose |
| --- | --- | --- |
| `plugins/dsh-cas-results` | `@yadsh/dsh-cas-results` | Content-addressed offload store for bulky tool results |
| `plugins/dsh-doc-impact` | `@yadsh/dsh-doc-impact` | Deterministic documentation-impact tracking |
| `plugins/dsh-domain-experts` | `@yadsh/dsh-domain-experts` | Configurable domain-scoped expert agents with isolated knowledge, memory and tool scope |
| `plugins/dsh-draft-sessions` | `@yadsh/dsh-draft-sessions` | Persistent unsent draft sessions |
| `plugins/dsh-git-readonly` | `@yadsh/dsh-git-readonly` | Read-only git provenance tools |
| `plugins/dsh-jev-compaction` | `@yadsh/dsh-jev-compaction` | Jev-powered, replay-safe semantic pruning of stale tool results |
| `plugins/dsh-kv-persist` | `@yadsh/dsh-kv-persist` | Persistent KV-cache/session-state snapshots (llama.cpp slots) |
| `plugins/dsh-l10n-overrides` | `@yadsh/dsh-l10n-overrides` | Runtime localization overrides |
| `plugins/dsh-lightrag` | `@yadsh/dsh-lightrag` | LightRAG knowledge-base tools |
| `plugins/dsh-model-safety-gate` | `@yadsh/dsh-model-safety-gate` | Two-layer safety gate for prompts, streamed output, tools, and tool results |
| `plugins/dsh-openviking-memory` | `@yadsh/dsh-openviking-memory` | OpenViking memory integration with configurable automatic context injection |
| `plugins/dsh-plugin-log-ui` | `@yadsh/dsh-plugin-log-ui` | Live logging levels and readable file-format settings |
| `plugins/dsh-preset-persona-editor` | `@yadsh/dsh-preset-persona-editor` | Agent-preset persona editing in the settings UI, written back into the preset's own composition |
| `plugins/dsh-prompt-firewall` | `@yadsh/dsh-prompt-firewall` | Prompt policy, hygiene, and observability |
| `plugins/dsh-qa-surface` | `@yadsh/dsh-qa-surface` | Focused end-user QA surface backed by native sessions |
| `plugins/dsh-session-audit` | `@yadsh/dsh-session-audit` | Session audit registry and viewer: an Audit view beside Chat and Trajectory |
| `plugins/dsh-session-scope` | `@yadsh/dsh-session-scope` | Per-session workspace visibility scopes |
| `plugins/dsh-sleev` | `@yadsh/dsh-sleev` | Sleev routing observability |
| `plugins/dsh-tool-offload` | `@yadsh/dsh-tool-offload` | Offloads large tool results to small one-shot worker agents |
| `plugins/dsh-ui-repair` | `@yadsh/dsh-ui-repair` | Reversible DOM diagnostics and scoped UI repairs |
| `plugins/dsh-user-correction-miner` | `@yadsh/dsh-user-correction-miner` | Mines project-rule candidates from user corrections |
| `plugins/dsh-web-fetch-authenticated` | `@yadsh/dsh-web-fetch-authenticated` | Authenticated, policy-gated web_fetch provider |
| `packages/config` | private workspace package | Shared tsconfig and vitest presets |
| `packages/plugin-log` | `@yadsh/dsh-plugin-log` | Structured file logging and runtime consumer discovery |
| `packages/plugin-kit` | private workspace package | Shared runtime helpers |
| `packages/test-kit` | private workspace package | Shared test helpers |

Runtime plugin IDs remain unscoped (`dsh-*`) because DSH bundle composition and
browser module loading use those IDs. The `@yadsh` scope is the npm package
identity.

## Development

Requirements: Node.js 22 or newer and pnpm 10.4.1.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm deps:check
pnpm tarball:verify
```

Nx runs project-local `lint`, `typecheck`, `test`, `build`, and `verify` scripts and caches
their outputs. The dependency check enforces workspace boundaries, while the
tarball check packs every public package, validates its manifest and exported
files, and installs it in a clean consumer project.

`plugins.json` is generated from the workspace manifests. Regenerate it after
changing a package description, keywords, or the package set — `pnpm
verify:packages` fails while the catalog is stale:

```bash
pnpm plugins:manifest
```

## Adding a plugin

```bash
pnpm nx g dsh-plugin <name> [--client] [--description "..."]
```

The generator defaults to the `@yadsh` npm scope and creates the package,
Cordis patch, build configuration, tests, and public-package metadata. The
scaffold is a starting point: before writing code, read the
[plugin guidelines](docs/PLUGIN_GUIDELINES.md) — the canonical architecture,
package-content, testing, documentation, and release rules every plugin must
follow. Run `pnpm plugins:manifest` afterwards so the new package enters the
catalog.

## Documentation

- [Architecture overview](docs/ARCHITECTURE.md) — layout, host/client split, build outputs, dependency rules
- [Plugin guidelines](docs/PLUGIN_GUIDELINES.md) — the canonical rulebook every plugin must follow
- [Plugin logging](docs/PLUGIN_LOGGING.md) — file logging API, formats, levels, console mirror
- [Verification runbook](docs/VERIFICATION.md) — what each gate asserts, locally and in CI
- [Releasing](docs/RELEASING.md) and [compatibility policy](docs/COMPATIBILITY.md)

## Releases

Packages use independent Nx Version Plans:

```bash
pnpm release:plan
pnpm release:check
pnpm release:dry-run -- --first-release
```

The GitHub release workflow builds and verifies selected package tarballs before
publishing through npm Trusted Publishing. See [the release runbook](docs/RELEASING.md)
and [compatibility policy](docs/COMPATIBILITY.md).

## License

MIT
