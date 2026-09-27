---
"@yadsh/dsh-preset-persona-editor": patch
---

The persona page names its own markup, so a test stops depending on its wording.

Every interactive node, every state and every zone the page renders now carries a
`data-testid`: the page root and its loading, failed, empty and notice states; a
roster row with its header, its badge and its body; the persona fields, both
checks and the complete-prompt warning; the Advanced prompt-sections area with
the row template inside it (name, order, enabled, remove, text, its own issue and
first-party-name warnings) and its add/remove-all actions; the copy form and both
of its buttons; the disclosures that say what a row carries beyond this editor;
and the preview with its outline, its three disclosures and its own rows. The ids
are ASCII kebab-case under the page's `persona-` zone and unique in the package,
and a repeated node keeps the id of its template rather than one id per row.

Only the attribute was added. No class, no copy, no layout moved, and the card
shell this page reuses inside `settings.section` — the `dsh-plugin-card` classes,
the header button with its `aria-label` and its SVG chevron — is exactly as
`AGENTS.md` specifies it.

No test of this package reached a node by text or class, so none had to move: the
page is covered at the store, Remote and file layers, and its copy lives in one
dictionary on purpose. The ids are what a browser test still lacks — a way to
name a field without quoting the sentence next to it.
