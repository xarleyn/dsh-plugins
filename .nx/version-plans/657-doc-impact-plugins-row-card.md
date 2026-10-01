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
the tab's seat id, its `order` and its `label` — a keyed seat carries a `key` and
those three belong to list seats — and the page titles the row from the row's own
metadata (its `meta.title`, else the module name the patch names), so the label this
entry used to hand the tab is now dead weight rather than a second title.

What the card renders is the same card: the same shell every DSH configuration card
uses (the card-contract gate reads no slot name, so it fires on the new registration
exactly as it did on the old), the same staged drafts, the same field-granular writes
fenced by the revision read at the moment of writing, the same unsaved badge and
per-field reset to the composition layer. Three details follow from the new seat rather
than from a redesign. The seat is asked for two views: `{ view: 'page', form }` for the
configuration section, and `{ view: 'summary' }` for the row's one-liner — which the page
asks this seat for because the patch declares no description of its own, as
`docs/DSH-0.1.7-MIGRATION.md` §4.2 now records at both render sites
(`PluginManagerPage.tsx:495` and `:491`). So the entry chooses a component per view where
it registers, rather than returning early inside the card: that is what keeps each view
its own hook order, and what keeps the one-liner a line of text that reads no settings
state instead of a second live copy of the form mounted in the page's heading. Its text
still arrives through the translate function the page binds for the locale namespace this
entry declares — and that is the only copy this entry used to hold itself: the tab's
`label` was the one string this bundle translated outside the card, so the bundle stopped
binding its own translator and the fallback dictionary it kept for that label went with
it. And the shell's `<li>` still needs a list to sit in, which the configuration section
does not supply, so the plugin-owned `<ul>` stays with the page view. The page puts its
own title, icon and crumb *above* the entry and draws no box around the configuration
section, so our card keeps its own frame rather than nesting inside a host one.

The manifest needed no new dependency, and that is a property of this entry rather
than an oversight: the bundle registers through the injected `slots` service by slot
name and reaches the settings surface as a type only, so there is no new runtime
surface to anchor a peer on (`dsh.client.inject` names exactly the packages whose
surfaces a client imports). The
browser half does now depend on the Plugins page existing, and says so —
`compatibility.json` lists `plugins.row.config` among the required client features,
which is why this is `minor` rather than `patch`: a browser on a host without that
page loses the card. `tests/client-bundle.test.ts` reads the seat key and the settings
namespace from `cordis.patch.yml` rather than repeating them, so a row id that moves in
the patch reddens the test instead of quietly dropping the configure control, and it
drives the entry through both views the page asks this seat for — the page view mounting
the shell and reading settings exactly once, the summary view answering as text with no
settings read at all. The page view is rendered with the page's own `form` prop present
and poisoned on both of its halves, because the card deliberately takes nothing from it:
the seat hands a `{ state, mutate }` whose `state` is one snapshot the page took while it
rendered, and a card that has to follow a write it did not make reads and fences the
document through the `ConfigForm` it resolves itself. `tests/client-render.test.ts` runs
its field-by-field render through that registered entry as well as through the card, so
an entry that stopped forwarding the props the card draws with is a missing control on a
screen, not a comment.
`scripts/verify-client-bundle.mjs` checks values, not the spellings of the constants
that spell them: the slot literal, the package-name half of the key as the patch names
it, the row id the bundle carries, the `view === "summary"` branch the page depends on,
the seat being claimed inside a served-namespace watch, and the absence of the
`settings.plugins.tab` seat this card vacated.
