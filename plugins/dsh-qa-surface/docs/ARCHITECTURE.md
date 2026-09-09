# Architecture

The Host half validates the Loader configuration, registers the `qa-surface`
settings namespace and owns one narrow GET/HEAD route for the configured QA
path. Published DSH `0.1.1-rc.2` returns 404 for unknown frontend paths, so the
route redirects navigation through the canonical `/` index with an encoded
same-origin path marker. It also exposes one typed
`secureSession(sessionId)` operation whose policy is read only from Host
settings. The entry delegates that operation to `QaPolicyAdmission`
(`secure-session.ts`), the Host-side admission boundary. It does not serve
HTML, create another server, replace the frontend fallback, or touch
API/plugin routes. The browser removes the
marker and restores the requested path with `history.replaceState` before
route matching. The Host creates no sessions itself.

The browser half registers `QaSurface` in the root-scoped `shell.overlay` list.
`QaRouteController` keeps that entry dormant outside the configured path and
reversibly observes `pushState`, `replaceState` and `popstate`.

`QaSessionController` is the only browser-side DSH session-coupled module. It uses
`connection.api.sessions.create/selectModel` for creation policy and the public
`SessionFace` for prompt, cancel and snapshots; the shared client contracts and
the idle state live in `client/types.ts`. Its supporting modules are pure
helpers: `client/wait-for.ts` waits on observable stores, `client/chat-index.ts`
(`QaChatIndex`) keeps the browser-local chat index and persisted active
session in storage, and `client/attestation.ts` parses Host reason markers and
validates proofs against the deployed lockdown config. `QaTranscriptAdapter`
projects session snapshots to plugin-local messages. "New chat" enters a
draft that materializes an attested session only when the first prompt is
sent, and the chat list orders by the host's `updatedAt`. By default it excludes
reasoning, tool arguments and tool results. When explicitly enabled, it
correlates assistant blocks, paired tool results, running calls and turn
timings into one plugin-local work group per turn; `QaWorkGroup` owns
disclosure state and collapses the group when the turn completes. System
context and raw failures remain excluded.

In locked mode the Host operation verifies immutable session composition,
refuses to adopt a non-QA session with user history, validates the named
permission preset, installs `ToolRestriction.allow`, installs an agent-scoped
monotonic execution guard, selects the permission preset, and returns only a
sanitized proof. The controller remains non-writable until every proof field
matches its Host-delivered config and repeats the check before prompt
admission. No private RPC handler, slash command, direct provider API, or DSH
core patch is used.

This narrows a QA agent's effective session/tool policy, but a route overlay on
a shared privileged Host is not an authorization boundary for other DSH
clients. Strong isolation requires a dedicated process/profile, restricted
identity and network boundary.

The overlay locks document scrolling and contains keyboard focus while active.
It does not locate AppFrame through generated CSS classes and does not dispose
global DSH runtime services when the route changes.
