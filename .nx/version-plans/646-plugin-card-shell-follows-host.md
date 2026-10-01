---
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-plugin-kit": patch
---

The Safety Gate settings card now takes the frame the Plugins page already draws.

Its row on the Plugins panel is seated inside the page's own card: the page paints the
surface, the heading, the row id and the expand control, and only then mounts the
bundle's body. Until now the bundle drew a second card around its own settings — a
12 px rounded rectangle with our chevron, inside the page's 20 px one — so the gate's
row read as a nested panel next to first-party rows. The body arrives directly: the
configuration sections are mounted without a shell of ours, without the injected shell
stylesheet, and without a show/hide button that duplicated the page's own toggle. The
live mode and the block counters were already in the status section, so the header
badge that repeated them is gone with the header.

Focus rings come from the Host's design system now
(`--dsw-focus-ring-width` / `--dsw-focus-ring-color`) instead of a hard-coded outline.
`focus.css` of the Host suppresses an outline under pointer modality at a higher
specificity than our rule, so the previous ring could paint transparent after a mouse
click; taking the tokens is what the first-party cards do.

Nothing about the settings themselves moved. The row seat stays keyed
`@yadsh/dsh-model-safety-gate#dsh-model-safety-gate`, and that key is also the namespace
the Host resolves the volatile Config under, so every value saved before this change
still reads back and writes to the same path.

Decided by the maintainer on 2026-10-01 as option 1 of the card-shell question in
`docs/DSH-0.1.7-MIGRATION.md` §4.3; the same change is being applied to the other plugin
cards that register on this row.

`@yadsh/dsh-plugin-kit` ships unchanged code — its shell and chevron stay for the cards
that still own one — but its package gate now calls `verifyCanonicalShell` instead of the
seat-aware dispatcher, because the kit publishes the shell that others inline and
registers on no seat itself. The bump is for that gate change, matching how
`shared-package-verify-gates` treated the same situation.
