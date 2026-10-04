---
"@yadsh/dsh-documents": patch
---

The Plugins row of this bundle now reads in the language the host is set to.

A row on the Plugins panel takes its title and description from the package's
exported display metadata at `./locale/en.json`, not from a label the card
supplies — that is what lets the same row speak the host's language without the
card knowing which language it is drawn in. This bundle's English file carried
its Russian text instead, so an operator on an English host saw the row named in
a language none of its neighbours used, and a Russian reader had no separate
string to fall back to.

The English strings are the ones the plugin has always meant: the pipeline that
converts Markdown to DOCX and PDF, extracts text, and reaches online sources.
Nothing moved, nothing was renamed, and the settings namespace the row resolves
its form under is untouched, so a saved value stays readable.
