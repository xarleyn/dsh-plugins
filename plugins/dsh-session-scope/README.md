# dsh-session-scope

An independent per-session workspace visibility layer for DeepSeek Harness.
A session keeps its original workspace and cwd while exposing only explicitly
selected workspace directories to the agent.

The central policy rule is:

```text
Permission != Scope
```

Permission controls effects (`read-only`, `workspace-write`, or
`danger-full-access`). Session scope independently controls which part of the
workspace is visible (`full`, `focused`, or Linux `isolated`).

## Development status

`0.5.0` implements the specification through Phase 4. It currently contains:

- a TypeScript port of the reusable upstream directory picker, path safety,
  filesystem fence, and sandbox integration;
- a strict TypeScript session-scope domain model;
- the durable `session-scope/set` snapshot and last-write-wins fold;
- `full`, `focused`, and `isolated` state vocabulary;
- canonical root validation, nested-root collapse, navigation ancestors, and
  stable error codes;
- typed host operations (`getScope`, `setScope`, `listScopeDirectory`, and
  `getScopeCapabilities`) plus the `/scope` command and `session-scope`
  projection;
- pure visibility rules for content vs. navigation paths, filtered directory
  listings, and scoped glob/grep/search roots;
- runtime filesystem enforcement carried per session with `AsyncLocalStorage`,
  including text and bounded byte reads, plus a monotonic final guard for
  known path-aware tools;
- broad `glob`/`grep` composition across selected content roots, including
  fail-closed handling for an omitted path and output path revalidation;
- model-facing scope context that exposes accessible roots without naming
  hidden siblings;
- an independent `Scope` chip and tree picker portaled beside Workspace on
  blank sessions and rendered beside permission in the active composer;
- Linux `isolated` process confinement through DSH's existing bubblewrap
  provider for one-shot bash and persistent PTY creation;
- an empty workspace overlay with only selected roots rebound, permission-aware
  read-only/writable mounts, and a post-mount working directory;
- functional backend capability detection plus fail-closed handling for
  unknown runner profiles, partial enforcement, unsupported platforms, and
  `danger-full-access`;
- a process lifecycle fence that prevents scope changes while foreground or
  background shell jobs and persistent terminals retain an old mount view;
- scoped pre-step filesystem context for workspace instructions and project
  skill discovery, while user/OS paths outside the workspace retain ordinary
  DSH policy;
- fail-closed LSP calls under selected scope because the current upstream LSP
  provider indexes the whole session workspace;
- fork inheritance through the durable seed plus fail-closed subagent
  initialization before child publication, including nested and resumed
  children;
- compatibility folding for legacy `workspace-scope/selection` sessions;
- Vitest coverage for the ported primitives and new scope state.

Focused scope covers DSH filesystem services and known path-aware tools, but
does not confine arbitrary shell processes. Isolated scope additionally
confines DSH's supported bash and PTY launch paths when the Linux provider
selects a fully enforcing, recognized bubblewrap profile. It is unavailable on
other backends and cannot currently be combined with `danger-full-access`;
these combinations fail closed instead of silently degrading to Focused.

## Installation

```sh
npm install @yadsh/dsh-session-scope
```

The package ships the DSH bundle patch as `cordis.patch.yml` and exposes its
server and web-client entry points through the package `exports` map. Node.js
20 or newer is required.

## Development

```sh
npm install
npm run check
```

CI runs the TypeScript build, Vitest suite, package-contract checks, and a
packed-plugin composition smoke test against the DSH releases listed in
[`compatibility.json`](compatibility.json) on Linux, macOS, and Windows.

TypeScript sources live in `src/`; `npm run build` emits distributable ES
modules, source maps, and declarations into `lib/`. Tests run with Vitest.

## Prior art and attribution

The initial directory picker, path canonicalization, filesystem fencing, and
sandbox integration were adapted from
[`dsh-workspace-scope-selection`](https://github.com/jiangr100/dsh-workspace-scope-selection)
by [jiangr100](https://github.com/jiangr100), used under the MIT License. The
original copyright notice is preserved in [LICENSE](LICENSE).
