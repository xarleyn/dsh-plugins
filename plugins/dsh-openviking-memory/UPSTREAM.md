# Upstream provenance

This package is derived from:

- Project: OpenViking
- Authors: OpenViking / Volcengine contributors
- Repository: https://github.com/volcengine/OpenViking
- Original package: `@openviking/dsh-memory-plugin`
- Original path: `examples/dsh-memory-plugin`
- License: Apache License 2.0 (see `LICENSE`, copied verbatim from
  `examples/LICENSE` at the imported revision)
- Imported from commit: `688f78e923d2269d96c27096fe2dad10156ebdb8`
- Upstream version: `0.3.2`
- Imported on: 2026-09-14

`688f78e9` is the release commit whose `package.json` reads `0.3.2`, which is
also the version npm published as `latest` on 2026-09-14. Every file under
`src/openviking/`, plus `src/client.ts` and `src/servers/mcp-proxy.ts`, was
ported from that revision and carries the changed-file notice described below.

## NOTICE handling

No `NOTICE` file exists at `examples/NOTICE` or
`examples/dsh-memory-plugin/NOTICE` at this revision (the only
`THIRD_PARTY_NOTICES.md` in the repository lives under
`openviking/parse/parsers/code/ast/queries/` and does not cover this package).
This was verified against the pinned commit, not assumed to hold upstream.

## Local modifications

The `@yadsh` fork adapts the plugin to the `xarleyn/dsh-plugins` monorepo
conventions and adds configurable automatic memory injection, including
manual-only OpenViking operation:

- The upstream `.mjs` sources are ported to TypeScript and reorganized under
  `src/`, with a typed Schemastery `Config` schema replacing upstream's loose
  config object.
- Automatic context presentation (startup profile, per-step profile, automatic
  recall) is governed by `autoInject`, `injectStartupProfile`,
  `injectStepProfile` and `autoRecall`. With `autoInject: false` the plugin
  issues no profile or recall request at all, while tools, skills, capture,
  commit and the `viking://` guard keep working.
- Dropped while porting, because nothing in the DSH integration consumed them:
  the cross-harness session-bypass and Codex-id helpers in `session-model`,
  `readManifestVersion`, the `describeInputFilters`/`recallQueryFilters` doctor
  surface, `filterCaptureParts`/`extractCaptureTurns` rollout-log ingestion,
  and `downgradeToRecallBody`/`normalizeContextEntry`. See `SPEC.md`
  ("Deferred") for the full list and the reasoning.
- Dropped upstream's legacy `session.events` fallback in `hasStartupProfile`:
  DSH 0.1.5 removed `session.events` in favour of `session.ownEvents()`, which
  is what the fork reads.
- The upstream bundle patch wrapped the runtime in a
  `@deepseek-ai/cordis-plugin-group` row with `isolate: { openvikingMemory:
  true }`. The fork uses this repository's canonical single-row bundle patch
  instead; the service is provided by a Cordis `Service` subclass, which keeps
  the same isolation guarantee for a single instance.

This document is the record of *what* changed; `docs/upstream-sync.md` describes
how to bring later upstream revisions in.

This project is not an official OpenViking distribution, and it is neither
maintained nor endorsed by the OpenViking project.

## Changed-file notices

Files that are directly based on upstream source open with:

```ts
/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */
```

No upstream copyright or attribution notice was removed from the imported
source. The vendored skill at `skills/openviking-memory/SKILL.md` is copied
verbatim from `examples/dsh-memory-plugin/skills/openviking-memory/SKILL.md` at
the pinned revision, line endings aside.
