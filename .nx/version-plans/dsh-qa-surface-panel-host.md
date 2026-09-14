---
"@yadsh/dsh-qa-surface": minor
---

Turn `/qa` into a small extension host for optional feature panels. External
client plugins register metadata and navigation through `qaSurfacePanels` and
provide their body separately through the keyed `qa.surface.panel` slot. QA
Surface supplies launcher ordering, a resizable width-reserving desktop column,
narrow-screen fullscreen presentation, focus restoration, `keepMounted`
lifecycle behavior and crash isolation without importing any concrete Browser,
logs, artifacts or terminal implementation. The stable public types live at
`@yadsh/dsh-qa-surface/client/panels`, with an external consumer compile
fixture guarding the contract.
