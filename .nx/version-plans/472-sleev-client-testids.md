---
"@yadsh/dsh-sleev": patch
---

The Sleev settings card carries stable `data-testid` selectors.

Each field, its reset action, the Save and Discard footer buttons and the two
notices are now addressable by a test id. The card's copy is localized into
English and Chinese, so a label was never a stable locator for a browser test in
the first place; the id gives one. The `id` attributes the labels point at, the
read-only and invalid states and every existing class are unchanged.
