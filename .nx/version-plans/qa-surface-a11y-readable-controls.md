---
"@yadsh/dsh-qa-surface": patch
---

The QA surface's small controls say what they are, and its body text reads at 16px.

A browser round over the surface (1440/1280/390) collected eleven defects of one class —
a control that looks alive but is not, a hit target below the surface's own 44px minimum,
and body text at 11-15px. Each is fixed on its own:

- The `Агенты`, `Источники` and `Файлы` chips in the header were `disabled` at a zero
  counter: dimmed, outside the Tab order, and silent about what had run out. They now stay
  reachable as `aria-disabled` and name the empty state in their label and tooltip.
- `Чат` in the header carried the selected-tab treatment (`aria-current="page"`, accent
  color, a 2px underline) while being an unclickable `<span>`. With a rail or drawer open it
  is a real button that closes the panel and returns to the chat; with none open it stays a
  caption, which is the only state where it is not a control.
- At 390px the panel covers the screen and its only exit was the 26x26 close button, while
  the same stylesheet demands 44x44 for sidebar controls at that width. The close target,
  the panel tabs and the per-message actions now meet 44px, Escape closes the rail from
  anywhere, and the close control names the tab it dismisses.
- Assistant answers ran 15px (14px at 390px) against the user's 16px, and the settings and
  sign-in cards sat at 11-13px. Body text moves to 16px in both stylesheets; the deliberate
  exceptions (tooltips, counters, footer notes) are listed at the rule.
- A truncated conversation title in the history was cut at 20 characters with no ellipsis
  and no tooltip, so two chats beginning `Напиши двадцать корот…` were indistinguishable.
  The row now ellipsizes, carries the full name in its tooltip, and searches the full name.
- The third quick question was clipped at the right edge on a narrow screen and Tab did not
  scroll it into view; the chips now wrap.
- A refused attachment (an 11MB drop) left its red line above an empty composer after a
  successful send, and the Files panel printed `Рабочий каталог` twice — as the section
  heading and again as the root crumb.
- The approval card for a workspace delete showed an English reason inside a Russian
  interface, and the `/` palette mixed Russian badges with English command descriptions.
