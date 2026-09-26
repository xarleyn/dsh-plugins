---
"@yadsh/dsh-qa-browser": patch
---

Every part of the Browser panel now carries a `data-testid`, so a test can name
the node it means instead of guessing it from the Russian text beside it.

The panel's chrome is drawn from a handful of repeating classes — three nav
buttons share one, the device and menu toggles share another, and both tab and
stage use the same empty-state class — which left an automated check nothing
stable to point at: it had to match a visible string, and a reworded label broke
the test rather than the feature. Each zone of the panel now says what it is:
`panel-*` for the container, `tabs-*` for the strip, `toolbar-*` for navigation
and the address, `device-*` for the viewport row, `stage-*` for the page,
`menu-*` for the actions popover and `status-*` for the footer. The values are
ASCII kebab-case and unique in the package, and the menu entries carry the id of
the action they offer.

Nothing else moved: no class, no attribute the user sees, no layout — only the
test attribute. The panel's own tests now reach the viewport readout, the
blocked-tab marker, the stage canvas and the pointer-input chip by id, and keep
asserting every control through its role or accessible name.
