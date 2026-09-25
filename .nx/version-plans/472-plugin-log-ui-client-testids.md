---
"@yadsh/dsh-plugin-log-ui": patch
---

The plugin's browser markup carries stable `data-testid` selectors.

Both of the plugin's browser surfaces — the right Sidebar's log panel and the
settings card — are now addressable by a test id rather than by a CSS class or
the wording of a label, so a browser test that clicks Pause or reads a log line
no longer breaks when the copy around it is rephrased. Nothing moved, nothing
changed colour, and no existing `data-plu-*` hook was renamed: the ids are an
addition to the same elements.
