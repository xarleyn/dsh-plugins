---
"@yadsh/dsh-qa-surface": patch
---

Every control of the plugin settings card is now addressable by a stable test
id, so a browser run drives the card without naming the Russian words it paints.

The card body is the densest form in the plugin: thirteen sections, their
switches and fields, and the notices that appear when two of them contradict
each other. Its checks reached almost all of that through the copy an operator
reads — a section by its heading, a warning by its first words, the error plate
by its class — and copy is the weakest handle the surface offers: it is
localized, and a reworded hint silently broke the test that keyed on it.

The sections now carry `qa-settings-<section>` and their controls
`qa-settings-<section>-<setting>`, ASCII kebab-case with the zone in the prefix
and no index substituted into an id; a notice is named by what it warns about
(`qa-settings-lockdown-notice-disabled`), a status chip by what it reads out
(`qa-settings-status-accounts`), and the «изменено» marker by the section it
belongs to (`qa-settings-access-modified`). Two notices swap their wording
between the branches of a condition and keep one hook, since only one of them
is ever on screen; apart from that pair the open card answers to each name once.
The card shell keeps the contract `AGENTS.md` sets for it: the hooks
were added inside the body, and every className, role and aria attribute stays
byte-identical — the card looks and reads exactly as it did.

No release note is added for this: nothing a visitor sees has changed.
