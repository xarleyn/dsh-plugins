## 0.3.0 (2026-09-22)

### 🚀 Features

- A refused destination reaches the operator, not only the model. ([076c518](https://github.com/xarleyn/dsh-plugins/commit/076c518))

  When the URL and DNS policy refused a request, only the model saw why: the
  refusal travelled back as a tool result, the tab did not load, and the person
  looking at the Browser panel had no way to tell a broken page from a deployment
  that will not reach an intranet host. The panel now carries it.

  The session keeps what the policy refused for the page it is on — the policy
  code, whether the refused request was the page itself or something the page
  asked for, the refused host, how many requests were refused, and the refusal
  text, which already names the class of address and the setting that lifts the
  block — and the panel renders it above the status line, with the part the
  refusal cannot know: that `security.network.allowHosts` opens one host while
  `security.network.allowPrivateNetworks` opens every private range to whatever
  the model asks for, so the choice between them is the operator's. The same
  facts are logged as `browser.policy-refused`.

  The two kinds are kept apart because they are different problems. A refused
  navigation means nothing opened. A refused request means the page did open and
  is quietly missing an asset or an API answer — the page that looks broken
  rather than the one that was blocked — and the banner says exactly that before
  it names hosts. The gates that record are the ones whose refusal nobody sees:
  the agent's `browser_navigate` and its history moves, plus the provider's
  pre-dial validation of every request Chromium dials, told what it is gating so
  the two kinds stay distinct. The panel's own navigation keeps answering in its
  error line, where the person who typed the address is already looking.

  The notice belongs to the tab whose page dialled the request, because that is
  the page the operator is looking at: the banner explains the selected tab, the
  strip marks the other tabs that carry entries, and a refusal with no page
  behind it — a service worker's request — is shown beside the selected tab's own
  entries. The attribution holds from the first request a page makes: its
  identity is minted by a registry on the first question about that page rather
  than when the handle is created, and both the session record and the tab are
  registered before anything can be waiting on them, so a refusal that arrives
  while a tab is still being built lands on that tab instead of nowhere. Per tab it is a list: one entry per destination, repeats counted
  instead of appended, at most eight destinations, and a navigation empties the
  notice of the tab that navigates without touching a second tab's explanation of
  the page it is still showing. A page that keeps retrying a blocked endpoint is
  one thing to fix, and a list that reshuffles as the page fails reads as noise
  rather than a cause.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.2.2 (2026-09-21)

### 🩹 Fixes

- The browser panel's page preview renders again, and the panel stops ([adb1c74](https://github.com/xarleyn/dsh-plugins/commit/adb1c74))
  spamming frame requests.

  The frame poll effect invalidated its own in-flight work: its cleanup
  bumped the request sequence, while its dependency list contained the tabs
  array — a fresh object on every poll — so the effect re-ran each tick and
  every arriving `panelFrame` response was discarded as stale before it
  reached the stage. The visible result was a panel frozen on «Получаем
  изображение…» forever while the network log filled with half-megabyte PNG
  responses nobody rendered.

  The effect now depends on a boolean busy flag (any tab loading or the
  panel holding the lease) instead of the array, and the cleanup no longer
  bumps the sequence — superseded responses are still dropped by the
  per-refresh guard, but a frame that settles after a re-run mounts. The
  idle poll interval is raised from two to five seconds; the frame itself is
  fetched only when the selected tab's revision changes, so an idle panel
  costs one small `panelState` call instead of repeated image transfers. A
  frame-carrying screencast channel remains the structural fix and stays a
  documented non-goal of this release.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.10.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-18)

### 🩹 Fixes

- Say why a host was blocked, and what lifts the block. ([f2e677b](https://github.com/xarleyn/dsh-plugins/commit/f2e677b))

  `Private-network destinations are blocked by Browser policy.` was the whole answer a model and an operator got for a corporate hostname the deployment's DNS resolves into an internal range — which is the ordinary shape of an intranet Jira or wiki, not an attack. The refusal now names the host, the class of the address it resolved to (RFC1918, carrier-grade NAT, IPv6 unique-local) and the setting that allows it: `security.network.allowHosts` for one host, `security.network.allowPrivateNetworks` for the deployment. The loopback and link-local refusals carry the same detail. No address is disclosed in the message: the class is what a fix depends on.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.9.0

### ❤️ Thank You

- xarleyn @xarleyn

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