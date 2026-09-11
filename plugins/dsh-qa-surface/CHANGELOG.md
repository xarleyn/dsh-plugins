## 0.2.0 (2026-09-10)

- Added DSH-style symmetric transcript/composer width handles with adaptive
  defaults, viewport clamping, and per-route browser persistence.
- Added Host-owned structured source provenance for parent and delegated turns,
  replayable `qa/sources` snapshots, dedupe/ranking, opaque-provider reporting,
  grouped source UI, and safe rendered/raw file previews.
- Updated packed Host/browser smoke coverage for browser authentication,
  revisioned client batches, scoped Remote injection, and current Typert RPC
  envelopes.

### 🚀 Features

- Make the QA surface a complete end-user assistant shell: image attachments ([b9af082](https://github.com/xarleyn/dsh-plugins/commit/b9af082))
  (drag & drop, paste, and a picker with removable previews; base64 prompt
  parts the Host promotes to durable attachments, rendered back as clickable
  thumbnails), subagent delegation presentation (launch work items with the
  durable child id, settlement notices collapsed into titled expandable rows,
  an agents panel listing the chat's subagents, and live read-only subagent
  transcripts with a one-click return), source cards with a full-output detail
  pane, clickable links and an open action, answer regeneration with
  ChatGPT-style variant switching, message ratings with hover response
  metadata (duration, TTFT, tokens per second), a data-usage disclaimer
  plate under the composer, per-browser chat history
  ordered by host updates with search and a collapsible sidebar, lazy draft
  chats that create nothing until the first prompt, directory/workspace
  pinning with a dedicated `workspace-unavailable` refusal, the company
  interaction palette as `--dsh-qa-*` tokens, and a split of the surface into
  focused drawer, switcher, and formatting modules.

### 🩹 Fixes

- Pack the generated Typert host and remote-client entrypoints: the `files` ([0059cb4](https://github.com/xarleyn/dsh-plugins/commit/0059cb4))
  allowlist only kept declarations under `lib/types/`, so the `./remote` and
  `./typert` exports previously shipped without their implementation modules
  and type definitions.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-06)

### 🩹 Fixes

- Add the dedicated browser QA surface backed by native DeepSeek Harness ([dfdc430](https://github.com/xarleyn/dsh-plugins/commit/dfdc430))
  sessions.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

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
