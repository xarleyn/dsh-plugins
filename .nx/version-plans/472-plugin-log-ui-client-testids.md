---
"@yadsh/dsh-plugin-log-ui": patch
---

The plugin's browser markup carries stable `data-testid` selectors.

Both of the plugin's browser surfaces — the right Sidebar's log panel and the
settings card — are now addressable by a test id rather than by a CSS class or
the wording of a label, so a browser test that clicks Pause or reads a log line
no longer breaks when the copy around it is rephrased. No existing `data-plu-*`
hook was renamed, nothing moved and nothing changed colour: the ids are an
addition to the same elements.

One id carries a behaviour change rather than a test handle. A line of the log
buffer is named `log-panel-line`, and that name sits on the DOM translator's
protected-surface table in `@yadsh/dsh-l10n-overrides`, so from this release
machine translation leaves logged text alone and a line reaches the panel as the
plugin that wrote it phrased it. This package's `verify-package.mjs` gate pins
the id: renaming it fails the gate instead of quietly lifting that protection.
