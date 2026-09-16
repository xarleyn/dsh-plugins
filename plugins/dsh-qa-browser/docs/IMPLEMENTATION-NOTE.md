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
  content rendering. `browser_screenshot` persists through `ctx.attachments`
  and renders the returned native image reference.
- Typert Remote carries strict read-only panel state and bounded base64 PNG
  frames. Every call is authorized through QA Surface before session state is
  read.
- QA Surface publishes `@yadsh/dsh-qa-surface/client/panels`. A consumer must
  register metadata through `ctx.qaSurfacePanels.register`, then register its
  React body in keyed slot `qa.surface.panel` under exactly the same package id.
  Cleanup is deterministic and `keepMounted: true` is supported.
- The panel client emits the classic ModuleLoader wrapper with the exact id
  `@yadsh/dsh-qa-browser` and registers only through the public keyed seat.

## Implemented boundary

Phase 1 owns Playwright, process startup, per-session contexts, tabs, queues,
idle cleanup and crash state. It intentionally does not register model tools or
React UI. This follows the specification's PR slicing rule and keeps QA Surface
free of Browser dependencies.

The URL policy is introduced early because no future navigation entry point
should first exist without a server-enforced boundary. Redirect and subresource
requests are rechecked by Playwright routing; metadata endpoints remain denied
even when a hostname is explicitly allowed.

Because Chromium resolves DNS with its own recursive resolver, a policy check
that resolves the host server-side can be detached from the address the browser
finally dials: an authoritative DNS answerer is free to hand the two resolvers
different answers. Every request now passes a double resolve immediately before
`route.continue()`: the host is resolved a second time and compared with the
address set the policy check just verified, and a divergence is refused with
the same `BROWSER_HOST_BLOCKED` taxonomy. A residual TOCTOU remains — after the
check passes, Chromium may still be handed a different answer by a DNS that
pins its replies per resolver — so the verification narrows the rebinding
window rather than closing it; closing it would require pinning the verified
address inside Chromium itself.

## Semantic slice

The second implementation stage adds semantic snapshots, revision-bound refs
and focused agent tools on top of `QaBrowserService`. A deterministic form
fixture proves fill, select, checkbox and click behavior without CSS selectors.
The basic QA panel now follows those Host contracts with latest-revision
on-demand frames; live screencast and human takeover remain later phases.
