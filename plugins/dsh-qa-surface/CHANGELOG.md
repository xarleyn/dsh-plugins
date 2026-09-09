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
- Added LAN serving support: a shipped `deploy/qa-lan.patch.yml` webserver
  overlay, and a `qaSurface/describe` Host Remote the browser falls back to
  when the loopback-pinned settings namespace is unavailable, so branding,
  session pinning and lockdown UI switches keep working over the network.
