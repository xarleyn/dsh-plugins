---
"@yadsh/dsh-qa-browser": minor
---

Give the QA panel a browser's chrome instead of a preview.

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
