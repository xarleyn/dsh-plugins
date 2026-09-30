---
"@yadsh/dsh-doc-impact": minor
---

The settings card opens from the Plugins page now, as the configuration of its own row.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), the surface
a plugin claims when the Host owns no place for its page. But this card edits exactly
one thing — the bundle's own live Config — and `0.1.7` grew a surface for that: the
Plugins page declares `plugins.row.config`, a keyed seat whose entry opens as the
row's configuration section, under the page's own chrome. Registering there is the
difference between a settings page whose name an operator has to know and a configure
control on the row they were already looking at.

The key is `@yadsh/dsh-doc-impact#dsh-doc-impact` — this package's name joined to the
row id `cordis.patch.yml` declares. That join is what makes the move cheap and what
makes it safe: the row id is the same string the Host has filed this plugin's volatile
Config under since `#530`, so the namespace the page derives its form from and the
namespace this card reads are one namespace. **Nothing about where values are stored
changed**, and a mode, a template or a cap saved through the old tab is read back by
this build. What did leave are the names of the surface the card stopped occupying:
the tab's seat id, its `order` and its `label` — a keyed seat carries none of them,
and the page titles the row from the plugin's display name, so the label this entry
used to hand the tab is now dead weight rather than a second title.

What the card renders is the same card: the same shell every DSH configuration card
uses (the card-contract gate reads no slot name, so it fires on the new registration
exactly as it did on the old), the same staged drafts, the same field-granular writes
fenced by the revision read at the moment of writing, the same unsaved badge and
per-field reset to the composition layer. Two details follow from the new seat rather
than from a redesign. The page renders this one entry in two views — `page` for the
form, and `summary` for the one-liner it shows wherever the bundle declares no
description of its own — so the entry answers `summary` with the dictionary's
`cardDescription` and reads no settings state there: mounting the store inside the
page's description line would hang a second live subscription on it. And the shell's
`<li>` still needs a list to sit in, which the configuration section does not supply,
so the plugin-owned `<ul>` stays with it.

The manifest needed no new dependency, and that is a property of this entry rather
than an oversight: the bundle registers through the injected `slots` service by slot
name and imports no host package, so there is no surface to anchor a peer on
(`dsh.client.inject` names exactly the packages whose surfaces a client imports). The
browser half does now depend on the Plugins page existing, and says so —
`compatibility.json` lists `plugins.row.config` among the required client features,
which is why this is `minor` rather than `patch`: a browser on a host without that
page loses the card. `scripts/verify-client-bundle.mjs` asserts the slot literal,
both halves of the keyed seat, and that the shipped bundle carries the `summary`
branch; `tests/client-bundle.test.ts` asserts the keyed registration, that the seat
kept none of the tab's chrome, and that the summary view mounts no settings read.
