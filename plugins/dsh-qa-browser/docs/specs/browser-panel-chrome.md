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

## A refusal is the operator's to answer

The URL and DNS policy is deployment configuration, so a navigation it refuses
is not something the chat can fix — and until now the refusal reached the model
alone, as a tool result nobody else reads. The session records the last refusal
(`{code, host, message}`) and the panel renders it above the status line.

The gates that record are the ones whose refusal nobody sees: the agent's
`browser_navigate` and history moves, and the provider's pre-dial validation of
every request Chromium dials — which is how a page that loaded from an allowed
host but pulls a blocked resource gets an explanation. That gate is told what
it is gating (`isNavigationRequest()`) and which page dialled it: every page
handle carries an id, and the provider maps the request's Playwright page back
to it.

Both lookups that attribution depends on are ordered so that a request cannot
arrive before they are ready. The identity is minted by a small registry on the
first question about a page rather than at creation, so the route handler and
the page handle get the same answer whichever asks first. And the session
record is registered in the manager before its first tab exists, the tab before
the page's title is read — the title needs a round trip, and a refusal landing
in that round trip has to find a tab to belong to. A refused document and a refused subresource stay apart — one means
nothing opened, the other means the page is quietly missing an asset or an API
answer — and both belong to the tab whose page asked, which is what the panel
explains. The panel's own navigation deliberately does not record: its refusal
appears in the panel's error line already, and a banner repeating it would be
noise.

The entries travel with the tab, and the panel shows the ones belonging to the
selected tab plus the residue that has no page behind it (a service worker's
request). The strip marks a tab that carries entries, so a second page failing
is visible without the panel pretending it is the one on screen. Each list is
one entry per refused destination, counted rather than repeated — a page
retrying a blocked endpoint is one thing to fix. It is capped at eight
destinations per tab, keeping the first ones, because a banner that keeps
reshuffling as a page fails reads as noise instead of a cause. A navigation
empties the notice of the tab that navigates and the untabbed residue; a second
tab keeps the explanation of the page it is still showing.

The banner leads with which kind of failure the page hit («Политика Browser не
пускает на …» against «Страница загрузилась не полностью…»), then the
list, then the refusal text verbatim rather than paraphrased: that text already
names the host, the class of address and the setting that lifts the block, and
a second wording would be a second thing to keep true. What the banner adds is
the part the refusal cannot know — that the choice between one allow-listed host
and `allowPrivateNetworks` for the whole deployment belongs to the operator, and
that the two are not equivalent. A session the manager does not hold has
refused nothing.

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
- `tests/page-identities.test.ts` — one page, one identity, whoever asks
  first, and two pages never share one.
- `tests/session-manager-security.test.ts`, `tests/browser-panel-render.test.tsx`
  — a refused destination is recorded with its kind, host and the message
  naming the fix, on the tab whose page dialled it (or on the session when no
  page did), including a refusal that arrives while that tab's title is still
  being read; repeats count instead of appending; one tab's list stops at eight;
  a navigation empties that tab's list and leaves the other tab's alone; the
  panel words a refused page and a page with refused requests differently,
  marks the tab that carries entries, shows no banner for the tab that refused
  nothing, and shows no banner at all while nothing was refused.
