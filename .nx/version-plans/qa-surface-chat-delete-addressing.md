---
"@yadsh/dsh-qa-surface": patch
---

The sidebar's chat-delete control becomes addressable, so a run of deletions
removes the chats it points at.

The confirmation dialog arrived in 0.12.0, and the browser round that asked for
it named a second half of the same problem: after the first removal, the next
click did not reliably reach the row it was aimed at. Two things made the row
controls tell apart badly, and both are fixed here.

Every row's control carried the same accessible name — "Удалить чат" — while the
dialog carried that string as well, so neither a screen reader nor a test could
say which chat a control belongs to or tell the dialog from the button behind
it. The control now names its own chat ("Удалить чат «Как перевыставить счёт»"),
and the dialog is named for what it asks ("Подтвердите удаление чата").

The control is drawn only while its row is hovered, but transparency alone does
not step out of the way: it kept the right edge of the row and answered a click
that arrived without the row being hovered — measured in Chromium against the
shipped sheet, a blind `locator.click()` pressed it, which is how an automated
walk over the list removed rows nobody touched. (A pointer click cannot be
caught that way, because moving onto the row reveals the control.) The rule now
hands pointer input to the control exactly when it reveals it, so a click
without hover falls through to the chat itself, and the keyboard path is
unchanged, because focusing the control is itself a revealing condition.

Closing the dialog hands the keyboard back where it came from: cancelling
refocuses the row it was opened from, and a confirmed removal leaves focus in
the chat list rather than on the document body, so the next Tab continues among
the chats instead of restarting from the top of the page.

Tests cover the history case (a chat with a real title is not removed before the
dialog is answered), a run of deletions across rows that move up, focus
restoration in both directions, and the hit-testing rule in the sheet.
