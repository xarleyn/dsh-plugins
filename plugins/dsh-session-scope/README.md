# dsh-session-scope

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-session-scope.svg)](https://www.npmjs.com/package/@yadsh/dsh-session-scope)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-session-scope.svg)](https://www.npmjs.com/package/@yadsh/dsh-session-scope)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-session-scope.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Per-session workspace visibility scopes for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-session-scope` keeps a session's original workspace and working directory while exposing only explicitly selected workspace directories to the agent. Permission controls effects; scope independently controls visibility.

```text
Permission != Scope
```

[Specification](SPEC_%20dsh-session-scope.md) · [Compatibility matrix](compatibility.json) · [Release notes](RELEASING.md)

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-session-scope
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-session-scope
```

The package includes its Host and Web client entry points plus the `cordis.patch.yml` bundle patch. Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## Scope modes

| Mode       | Visibility and enforcement                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `full`     | The ordinary complete workspace view                                                                                 |
| `focused`  | Selected roots across DSH filesystem services and known path-aware tools; arbitrary shell processes are not confined |
| `isolated` | Selected roots plus Linux process confinement through a fully enforcing, recognized bubblewrap profile               |

`isolated` is unavailable on unsupported backends and cannot currently be combined with `danger-full-access`. Unsupported or partially enforced combinations fail closed instead of silently degrading to `focused`.

## What works now

Version `0.5.0` implements the specification through Phase 4:

- durable `session-scope/set` snapshots with a last-write-wins fold;
- canonical root validation, nested-root collapse, navigation ancestors, and stable error codes;
- projection-backed scope state and capabilities, a dedicated `sessionScope/list` RPC, and a write-only `/scope` command;
- filtered directory listings and scoped glob, grep, and search roots;
- per-session filesystem enforcement carried with `AsyncLocalStorage`;
- a monotonic final guard for known path-aware tools;
- model-facing context that names accessible roots without revealing hidden siblings; `full` emits no scope prompt and bypasses the filesystem carrier;
- an independent **Scope** chip and tree picker beside Workspace and permission controls;
- Linux isolation for one-shot bash and persistent PTY creation;
- permission-aware read-only and writable mounts in an empty workspace overlay;
- lifecycle fences that prevent scope changes while processes retain an older mount view;
- scoped project instructions and skill discovery;
- fail-closed LSP calls while the upstream provider indexes the complete workspace;
- scope inheritance for forks, nested subagents, and resumed children;
- compatibility folding for legacy `workspace-scope/selection` sessions;
- unit, integration, package-contract, and packed-composition coverage.

## Design boundaries

- `read-only`, `workspace-write`, and `danger-full-access` remain DSH permission modes; they are not scope modes.
- Focused scope constrains supported DSH services and tools, not arbitrary child processes.
- Isolated scope requires the supported Linux sandbox path and a recognized bubblewrap profile.
- Unknown runner profiles, partial enforcement, and unsupported platforms fail closed.
- Scope changes are blocked while foreground jobs, background jobs, or persistent terminals retain the previous mount view.
- Opening or refreshing the Scope editor is read-only: it uses projections and `sessionScope/list`, so it does not add command rows to session history. Applying an unchanged scope is a no-op.

## Requirements

- Node.js 20 or newer
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Linux with bubblewrap for `isolated` mode

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-session-scope check
```

The package check runs the TypeScript build, Vitest suite, client and package-contract checks, and compatibility verification. The packed-plugin smoke test can be run separately:

```bash
pnpm --filter @yadsh/dsh-session-scope smoke:packed
```

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Prior art and attribution

The initial directory picker, path canonicalization, filesystem fencing, and sandbox integration were adapted from [`dsh-workspace-scope-selection`](https://github.com/jiangr100/dsh-workspace-scope-selection) by [jiangr100](https://github.com/jiangr100), used under the MIT License. The original copyright notice is preserved in [LICENSE](LICENSE).

## Contributing

Issues and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) and run the package check before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
