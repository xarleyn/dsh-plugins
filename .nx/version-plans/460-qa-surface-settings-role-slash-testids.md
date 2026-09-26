---
"@yadsh/dsh-qa-surface": patch
---

The settings dialog, the role selector and the slash palette became addressable
from a browser run, so the parts of the surface a person configures can be
driven without naming the Russian words they are painted in.

Every check of these three zones reached its node through the copy on screen or
through a BEM class: a test found the account facts by the email it renders, the
refusal notice by its sentence, a starter row by `.dsh-qa-starters__item`, the
group headers of the palette by «Навыки», and the confirm button of a role change
by the name of the role it switches to. Copy is the weakest handle the surface
offers — it is localized, it changes with the state of a form, and the label of a
save button is literally the verb the feature is named after.

The components of `src/client/user-settings`, `src/client/role` and
`src/client/slash` now carry `data-testid`: `qa-settings-*` for the dialog shell
and its seven pages, `qa-role-*` for the selector and the confirmation it asks
for mid-conversation, `qa-admin-preview-*` for the preview banner and its way
out, and `qa-slash-*` for the palette, its groups and its rows. Values are ASCII
kebab-case and every zone keeps its own prefix. The field primitives the pages
share — a field, a section, a toggle, a notice, a button — take the id from their
call site rather than inventing one, so the same primitive reads
`qa-settings-profile-save` on one page and `qa-settings-tokens-revoke` on
another. A node repeated over a list keeps the value of its template — the tabs
of the dialog, the rows of the palette, the chips of granted tools — so no
account key is ever substituted into an id, and which one is meant stays the
run's business, told apart by the accessible name or the place in the list the
node already offered.

Only attributes were added: no element moved, no class changed and no style was
touched, so the dialog, the banner and the palette look and read exactly as
before. The package's own checks moved to the new handles wherever they had used
visible text or a class as the locator — the account facts, the leads and hints
of the pages, the notices that refuse a save, the rows of the catalog and of the
token list, the group titles and rows of the palette — while every assertion on
a role or an accessible name stayed where it was, because those are the checks
that keep the surface usable without a screen.
