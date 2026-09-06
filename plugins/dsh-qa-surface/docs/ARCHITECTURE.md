# Architecture

The Host half validates the Loader configuration, registers the `qa-surface`
settings namespace and owns one narrow GET/HEAD route for the configured QA
path. Published DSH `0.1.1-rc.2` returns 404 for unknown frontend paths, so the
route redirects navigation through the canonical `/` index with an encoded
same-origin path marker. It does not serve HTML, create another server, replace
the frontend fallback, or touch API/plugin routes. The browser removes the
marker and restores the requested path with `history.replaceState` before
route matching. The Host creates no sessions.

The browser half registers `QaSurface` in the root-scoped `shell.overlay` list.
`QaRouteController` keeps that entry dormant outside the configured path and
reversibly observes `pushState`, `replaceState` and `popstate`.

`QaSessionController` is the only DSH session-coupled module. It uses
`connection.api.sessions.create/selectModel` for creation policy and the public
`SessionFace` for prompt, cancel and snapshots. `QaTranscriptAdapter` projects
those snapshots to plugin-local messages, excluding reasoning, tool arguments,
tool results, system context and raw failures.

The overlay locks document scrolling and contains keyboard focus while active.
It does not locate AppFrame through generated CSS classes and does not dispose
global DSH runtime services when the route changes.
