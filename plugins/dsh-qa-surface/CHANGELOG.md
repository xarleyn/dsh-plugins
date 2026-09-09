# Changelog

## 0.1.0 - 2026-09-05

- Added the `/qa` full-screen overlay backed by native DSH sessions.
- Added persistent, new-on-load and fixed session policies.
- Added streaming transcript, Stop, New chat, safe Markdown and responsive UI.
- Added Host settings registration and safety filtering for internal events.
- Added a narrow Host navigation redirect for DSH releases whose static
  frontend returns 404 for direct `/qa` requests.
- Added fail-closed Host policy attestation, the `qa-read-only` permission pin,
  an inherited-tool allow-list, and a monotonic execution guard.
- Disabled session reset by default and added capability-regression gates.
- Refined the QA surface with first-party-style conversation chrome, plain
  assistant flow, user bubbles, copy actions and a floating two-row composer.
- Added opt-in reasoning and tool-call details grouped into a live turn work
  disclosure that collapses to a `Worked for …` summary before the final answer.
- Added an optional minimal chat-history sidebar (`ui.showSessionList`) with a
  per-browser localStorage chat index, attested switching and a gated
  New chat control.
- Send-time policy attestation now survives a Host that idled the session's
  agent out: the client re-binds the session (re-materializing the agent) and,
  when the refused session is still blank, continues in a fresh attested
  session instead of surfacing an error.
- Added GFM table, ordered-list and horizontal-rule rendering to the safe
  Markdown output.
- Added a two-click chat delete control to the chat-history sidebar; it
  removes the chat from the per-browser index only (DSH has no
  session-deletion seam).
- Added attestation diagnostics: the Host folds a coarse reason code into the
  refusal and the browser console prints one operator hint instead of a
  duplicate stack trace.
- Fixed repeated policy attestation for tools contributed by an agent preset:
  the applied restriction now retains the exact scoped allow-list instead of
  accidentally reducing it to global-only tools. Removed the redundant native
  presentation override so reloads cannot collide with the preset's mode.
- The browser re-reads the Host configuration when the connection is restored,
  so an open page survives a Host restart with a changed deployment config.
- Added LAN serving support: a shipped `deploy/qa-lan.patch.yml` webserver
  overlay, and a `qaSurface/describe` Host Remote the browser falls back to
  when the loopback-pinned settings namespace is unavailable, so branding,
  session pinning and lockdown UI switches keep working over the network.
- Localized the end-user chat interface into Russian, added rotating playful
  thinking phrases, and moved the default quick-question chips next to the
  composer on an empty chat.
