---
"@yadsh/dsh-preset-persona-editor": patch
---

The preset page's package gate now asserts the settings-card shell it renders.

The page mounts inside the native settings tree instead of registering a
`settings.plugin.item` card, so it draws the shared shell itself and nothing
checked that it kept drawing it: its gate asserted the bundle's identity and
that no node built-in reached it, but not one line of the shell contract. It now
runs the same card contract the card plugins run.

The contract itself gained the two assertions a stylesheet cannot carry. The
canonical rules prove a bundle is *styled* like a card; a bundle that injects
them and then draws its own outer shell — a `<div>` root, a header that is not a
toggle — passed every one of them. The rendered open-state class pair and the
header's `aria-expanded` are read from the bundle instead, so the shell has to be
built, not just styled.
