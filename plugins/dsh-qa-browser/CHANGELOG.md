## 0.2.0 (2026-09-17)

### 🚀 Features

- Re-check DNS immediately before the browser dials a host. ([f887079](https://github.com/xarleyn/dsh-plugins/commit/f887079))

  The Browser network policy resolved every destination host server-side and
  refused private, link-local and metadata answers, but the connection itself is
  made by Chromium, which resolves through its own recursive resolver. An
  authoritative DNS answerer under an attacker's control is free to hand the two
  resolvers different answers, so a hostname that checked out cleanly could still
  land the browser on an internal address.

  Every request now passes a double resolve just before Playwright lets it
  continue: the host is resolved a second time and compared with the address set
  the policy check just verified, and a divergence — including a host that stops
  resolving — is refused with the same `BROWSER_HOST_BLOCKED` taxonomy as the
  original check, so redirects and subresource requests surface the stable
  security error as before. A residual TOCTOU remains, because a DNS that pins
  its answers per resolver can still serve Chromium a different answer after the
  gate; the check narrows the rebinding window to hostile answerers that are
  additionally inconsistent under rapid repetition, and this limit is documented
  in the plugin's implementation note.

- Give the QA panel a browser's chrome instead of a preview. ([5693f36](https://github.com/xarleyn/dsh-plugins/commit/5693f36))

  The panel had a row of tab buttons, an address field, one image and a footer, so
  the operator could see which page the agent was on but could not act on it: the
  tabs could not be opened or closed, the address was the only way to go
  somewhere, and the browser's own three controls — back, forward, reload — had no
  Host path at all. The panel is now the browser it was showing: a tab strip with
  selection, a close button and a `+`, back/forward/reload, an address field that
  completes a bare host, a device row with width, height, presets and a
  fit/scale control, and a `⋯` menu for everything that does not deserve a
  permanent button.

  Back and forward are drawn from what the Host watched the tab visit — every
  navigation it performed and every one it saw committed through the page-change
  listener — because Chromium exposes no "is there an entry behind this page"
  question. The depth travels with each tab in the panel's state, the arrows grey
  out when there is nowhere to go, and a page that arrived through a redirect is
  recorded as a fresh entry rather than guessed at.

  Two facts divide the chrome, deliberately separately: the lease says who is
  driving, and the deployment's `capabilities.coordinateInput` switch says whether
  pointer gestures may be forwarded at all. A panel without the lease renders a
  disabled chrome and can still copy the address or refresh the image; clicks and
  context menus additionally need the switch, and the panel says so instead of
  failing one click at a time. Taking the lease on a chat whose browser has not
  started yet starts it, so the panel is not a dead end on a chat nobody has
  browsed in. The device row is clamped by the same bounds the agent's
  `browser_viewport` tool uses — one home for them now, in the Host.


### 🩹 Fixes

- Show the browser the agent is actually driving instead of an error line. ([70f3a3d](https://github.com/xarleyn/dsh-plugins/commit/70f3a3d))

  The QA panel authorizes every request against the admission boundary QA Surface
  publishes as the `qaSurface` service, but the Host read that service as a plain
  property while the plugin declares only `agents`, `attachments`, `tools` and
  `webServer` in its injection. Cordis refuses an undeclared service read, so every
  panel request — the two-second state poll, and with it the screenshot the poll
  would have asked for — failed with `cannot get property "qaSurface" without
  inject` before it ever reached the browser runtime. The agent kept working,
  because browser tools take their session id from the execution context and never
  touch that boundary; only the preview the operator watches was dead, and its
  error box was the one place the refusal showed up.

  QA Surface is not a declared dependency of this runtime by design — the plugin
  also loads on Hosts that never mount it — so the boundary is now resolved softly
  per request. A Host without QA Surface still refuses the panel, with the message
  that names the missing boundary, and a Host that mounts it later is honored
  without a reload.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.8.0
- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.6 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.4

## 0.1.5 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.3

## 0.1.4 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.2

## 0.1.3 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.1

## 0.1.2 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.0

## 0.1.1 (2026-09-15)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.1

## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce a session-scoped Playwright Browser runtime for DeepSeek Harness and ([3312277](https://github.com/xarleyn/dsh-plugins/commit/3312277))
  its QA Surface panel extension. The initial release provides isolated persistent
  BrowserContexts, semantic ref-based tools, durable screenshots, server-enforced
  network policy, automatic panel reveal, and explicit leased human takeover of
  the same agent tab.

  Chromium starts lazily and is never downloaded from `postinstall`. Container
  deployments can point at a managed browser executable while retaining the
  Chromium sandbox by default.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn