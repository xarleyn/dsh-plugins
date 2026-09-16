# The panel's browser chrome

The QA panel used to be a preview: a row of tab buttons, an address field, one
image, and a footer that said who was driving. This note records the change that
turned it into a browser — what the chrome is, what each control really does,
and which facts decide what it may do.

## What the chrome is

A tab strip, one bar carrying navigation and the address, an optional device
row, the page, and one status line. Nothing about it is decorative: every
control maps to a Host call, and one that cannot work is greyed out with the
reason rather than failing on click.

| Control | Host call | Notes |
| --- | --- | --- |
| Tab (click) | `panelSelectTab` | Selects the tab the agent also drives |
| Tab `×` | `panelCloseTab` | Closes that tab; the selection moves to the next |
| `+` | `panelNewTab` | Opens a blank tab, subject to `session.maxTabs` |
| `←` / `→` | `panelHistory back/forward` | Enabled from the tab's observed depth |
| `⟳` | `panelHistory reload` | Reloads the page |
| Address field | `panelNavigate` | A bare host is completed to `https://` |
| Device row | `panelViewport` | Width, height and a preset; clamped by the Host |
| Scale | — | Client-only: how much of the page the pane shows |
| `⋯` → control | `panelTakeControl` / `panelReleaseControl` | The same lease as the footer |
| `⋯` → refresh | `panelState` + `panelFrame` | Re-reads the image without waiting for the poll |
| `⋯` → copy | — | `navigator.clipboard`, with its refusal surfaced |
| `⋯` → reload, tabs | as above | Duplicates of the buttons above |

## Two facts, deliberately separate

The **lease** says who is driving. Only the panel that holds it may act: tabs,
navigation, the address field, the device row and pointer input all follow it.
A panel that merely watches renders the toolbar disabled, the address read-only,
and the tabs as a roster — it can still copy the address and refresh the image.

The **deployment's coordinate-input switch** (`capabilities.coordinateInput`)
says whether pointer gestures may be forwarded at all. Keys, text and scroll
follow the lease alone; clicks and context menus need both, and a deployment
that turned the switch off gets a chip saying so instead of an error per click.

## History depth

Chromium exposes no "is there an entry behind this page" question, so the Host
records what it watches each tab visit: every navigation it performs, and every
one it sees committed through the page-change listener. That mirrors what a
browser's own arrows act on. A page the browser visited without the runtime
watching — a redirect that replaced an entry — is recorded as a fresh entry
instead of guessed, so the arrows never claim a page that is not there. The
depth is capped at 50 entries per tab, oldest first.

The agent's own `browser_tabs` listing deliberately stays free of the depth: a
tool that never greys a button has no use for it. The panel gets it through
`listPanelTabs`, and the panel state carries it per tab.

## Taking control starts the browser

Asking for the lease on a chat whose browser has not started yet starts it.
Without that, an unstarted browser would be a dead end: every panel control
needs the lease, and the lease needs a session. The gesture is the human saying
"I want to drive", which is exactly the intent that should start Chromium.

## Sizes and scale

The device row offers a width, a height and four presets (laptop, desktop,
tablet, phone). The Host clamps every request to the same bounds the agent's
`browser_viewport` tool uses — `VIEWPORT_BOUNDS` in `src/host/viewport.ts` is
the single home for them, and the panel imports it so the two callers cannot
drift apart. The scale is the panel's own view preference: «По размеру окна»
fits the whole page into the pane, 100 % (and 75 %, 50 %) draws it at a fixed
pixel size and lets the pane scroll. Pointer mapping reads the image's bounding
rect either way, so a click lands on the same page pixel at any scale.

## Narrow panes

The panel is a grid with one `minmax(0, 1fr)` column: the tab strip is a
horizontal scroll container whose min-content contribution is its content, so
without that column the strip would push every other row wider than the pane.
The toolbar keeps one row (the address field shrinks), the device row and the
status line wrap. Verified at 320 px, 460 px and full width.

## What the tests pin

- `tests/session-manager.test.ts` — the observed history walks back and
  forward, a page that moved on its own becomes an entry, the panel's tab work
  needs the lease, and device sizes are clamped.
- `tests/remote.test.ts` — the new descriptors stay strict, and a panel tab
  without a history depth never validates.
- `tests/browser-panel.test.tsx` — the chrome's behaviour: a watcher cannot
  act, a lease holder can, the arrows follow depth, the address completes a
  bare host, the device row drives the viewport and the scale.
- `tests/address.test.ts`, `tests/chrome-copy.test.ts` — the pure wording and
  address rules.
- `tests/panel-authorization.test.ts` — every new mutation authorizes against
  QA Surface before it touches the browser.
