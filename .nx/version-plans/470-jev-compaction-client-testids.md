---
"@yadsh/dsh-jev-compaction": patch
---

The settings card names its own markup, so a test stops depending on its wording.

Every control the card renders now carries a `data-testid`: the five sections,
the status read-outs (enabled, provider, model, mode), each toggle, number
field, select and text field under the settings path it writes, the Advanced
disclosure, the two archive warnings, the read-only notice, each field's own
override mark and the Reset overrides button. The ids are ASCII kebab-case under
the card's own `jevc-` zone and unique in the package; the tag-list control
derives `-list`, `-tag`, `-remove`, `-add` and `-empty` from the id of the list
it belongs to, so the two tool lists on the card never claim the same hook.

Nothing about the card changed for a reader. Only the attribute was added — no
class, no copy, no layout, and the shell contract from `AGENTS.md` (the
`dsh-plugin-card` BEM classes, the SVG chevron, the design tokens) is exactly as
it was. The `id` attributes the labels point at stayed, so a screen reader still
names each field by its caption.

The card's own tests were the reason: they reached a field through its English
caption, its placeholder or a positional index over the two Add buttons, so a
reworded label failed a test that had nothing to do with the label. They now go
through the id, and the helper that resolves one still asserts that the caption
labels that very node — the accessibility wiring stays under test, only the
locator is stable.
