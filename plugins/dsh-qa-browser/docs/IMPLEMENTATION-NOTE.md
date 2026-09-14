# Phase 0 audit and Phase 1 boundary

This note records the target-branch checks made before implementing the
Browser runtime.

## Verified integration seams

- DSH Host services use Cordis `Service`, call `super(ctx, serviceName)`, expose
  the service through `Context` declaration merging and register deterministic
  teardown with `ctx.effect`.
- Session-owned cleanup can follow the global `agent/disposed` event used by
  the QA tool lifecycle. The Browser keys state by `String(agent.session.id)`.
- The target tool registry uses focused `defineTool` definitions and structured
  content rendering. The image-bearing tool-result path exists, but its exact
  artifact/attachment contract still needs a Phase 4 contract test before the
  Browser exposes `browser_screenshot`.
- Typert Remote is suitable for bounded JSON control/state. Binary-frame
  transport has not been assumed; Phase B starts with bounded on-demand frames
  and must choose its wire representation after a dedicated carrier test.
- QA Surface publishes `@yadsh/dsh-qa-surface/client/panels`. A consumer must
  register metadata through `ctx.qaSurfacePanels.register`, then register its
  React body in keyed slot `qa.surface.panel` under exactly the same package id.
  Cleanup is deterministic and `keepMounted: true` is supported.
- Every package declaring `dsh.client` must emit the classic ModuleLoader
  wrapper with the full scoped npm package name. This runtime-only slice does
  not declare `dsh.client`; the panel slice will add and verify it.

## Implemented boundary

Phase 1 owns Playwright, process startup, per-session contexts, tabs, queues,
idle cleanup and crash state. It intentionally does not register model tools or
React UI. This follows the specification's PR slicing rule and keeps QA Surface
free of Browser dependencies.

The URL policy is introduced early because no future navigation entry point
should first exist without a server-enforced boundary. Redirect and subresource
requests are rechecked by Playwright routing; metadata endpoints remain denied
even when a hostname is explicitly allowed.

## Next slice

The next change should add semantic snapshots, revision-bound refs and focused
agent tools on top of `QaBrowserService`. The panel should follow only after
those Host contracts and the native screenshot artifact result are stable.
