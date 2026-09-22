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

The table is generated from the workspace manifests. Published packages show
their npm name; private build tooling stays listed as a private workspace
package.

| Directory | npm package | Purpose |
| --- | --- | --- |
| `plugins/dsh-answer-review-gate` | `@yadsh/dsh-answer-review-gate` | Independent answer review gate for DeepSeek Harness agent responses |
| `plugins/dsh-cas-results` | `@yadsh/dsh-cas-results` | Content-addressed offload store for bulky DeepSeek Harness tool results |
| `plugins/dsh-doc-impact` | `@yadsh/dsh-doc-impact` | Deterministic documentation impact engine for DeepSeek Harness |
| `plugins/dsh-documents` | `@yadsh/dsh-documents` | Managed document pipeline for the DeepSeek Harness: Markdown to DOCX/PDF, DOCX/PDF back to Markdown, and online sources as agent tools |
| `plugins/dsh-domain-experts` | `@yadsh/dsh-domain-experts` | Configurable domain-scoped expert agents for DeepSeek Harness |
| `plugins/dsh-draft-sessions` | `@yadsh/dsh-draft-sessions` | Persistent unsent draft sessions for DeepSeek Harness |
| `plugins/dsh-git-readonly` | `@yadsh/dsh-git-readonly` | Read-only git provenance tools for DeepSeek Harness agents |
| `plugins/dsh-jev-compaction` | `@yadsh/dsh-jev-compaction` | Jev/System-One semantic pruning of stale tool results for DeepSeek Harness; keeps conversation text verbatim and forgets stale tool output before summary compaction is needed |
| `plugins/dsh-kv-persist` | `@yadsh/dsh-kv-persist` | Persistent KV-cache/session-state manager for DeepSeek Harness (llama.cpp slot snapshots) |
| `plugins/dsh-l10n-overrides` | `@yadsh/dsh-l10n-overrides` | English localization overrides for DeepSeek Harness plugins |
| `plugins/dsh-lightrag` | `@yadsh/dsh-lightrag` | LightRAG knowledge-base tools for DeepSeek Harness agents |
| `plugins/dsh-model-safety-gate` | `@yadsh/dsh-model-safety-gate` | Independent two-layer safety gate around the DeepSeek Harness agent loop: deterministic and model-classifier verdicts for prompts, streamed output, tools, and tool results |
| `plugins/dsh-openviking-memory` | `@yadsh/dsh-openviking-memory` | OpenViking memory integration for DeepSeek Harness with configurable automatic context injection; derived from the official OpenViking DSH plugin. |
| `plugins/dsh-plugin-log-ui` | `@yadsh/dsh-plugin-log-ui` | DSH settings UI for shared plugin logging levels and file format |
| `plugins/dsh-preset-persona-editor` | `@yadsh/dsh-preset-persona-editor` | Edit an agent preset's persona for the DeepSeek Harness from the settings UI: prefix, suffix, complete mode, and the runtime-context toggle, written back into the preset's own agent.cordis.yml |
| `plugins/dsh-prompt-firewall` | `@yadsh/dsh-prompt-firewall` | Prompt hygiene, observability, and policy middleware for DeepSeek Harness |
| `plugins/dsh-qa-browser` | `@yadsh/dsh-qa-browser` | Session-scoped Playwright browser runtime for DeepSeek Harness and QA Surface |
| `plugins/dsh-qa-integrations` | `@yadsh/dsh-qa-integrations` | Principal-scoped, encrypted user integrations for DSH QA Surface |
| `plugins/dsh-qa-surface` | `@yadsh/dsh-qa-surface` | A focused end-user QA surface backed by native DeepSeek Harness sessions |
| `plugins/dsh-session-audit` | `@yadsh/dsh-session-audit` | Session audit registry and viewer for DeepSeek Harness: an Audit tab in every session, driven by audit artifacts on disk |
| `plugins/dsh-session-scope` | `@yadsh/dsh-session-scope` | Per-session workspace visibility scopes for DeepSeek Harness. |
| `plugins/dsh-sleev` | `@yadsh/dsh-sleev` | Sleev routing observability for DeepSeek Harness |
| `plugins/dsh-tool-offload` | `@yadsh/dsh-tool-offload` | Offloads large, low-judgement DeepSeek Harness tool results to small one-shot worker agents before they enter the main model context |
| `plugins/dsh-ui-repair` | `@yadsh/dsh-ui-repair` | Reversible DOM diagnostics and scoped UI repairs for DeepSeek Harness plugins |
| `plugins/dsh-user-correction-miner` | `@yadsh/dsh-user-correction-miner` | Mine durable project-rule candidates from user corrections in DeepSeek Harness sessions |
| `plugins/dsh-web-fetch-authenticated` | `@yadsh/dsh-web-fetch-authenticated` | Authenticated, policy-gated WebFetchProvider for the DeepSeek Harness web capability seam (ctx.web) |
| `packages/audit-core` | `@yadsh/dsh-audit-core` | Session audit artifact domain layer for DeepSeek Harness: schema, parsing, validation, summary and atomic publishing |
| `packages/audit-ui` | `@yadsh/dsh-audit-ui` | Shared audit presentation components for DeepSeek Harness: sanitized report rendering, findings, scorecard and JSON view |
| `packages/config` | private workspace package | Shared TypeScript and build configuration for DSH plugins monorepo |
| `packages/plugin-kit` | `@yadsh/dsh-plugin-kit` | Shared runtime helpers for DSH plugins: logging scaffolds, config validation, compatibility checks and SQLite store plumbing |
| `packages/plugin-log` | `@yadsh/dsh-plugin-log` | Shared structured file logging and runtime logger discovery for DSH plugins |
| `packages/plugin-scripts` | private workspace package | Shared build/verify script runners for DSH plugins |
| `packages/test-kit` | private workspace package | Testing utilities for DSH plugins |

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

`plugins.json` and the package table above are generated from the workspace
manifests. Regenerate both after changing a package description, keywords, or
the package set — `pnpm verify:packages` fails while either catalog is stale:

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
