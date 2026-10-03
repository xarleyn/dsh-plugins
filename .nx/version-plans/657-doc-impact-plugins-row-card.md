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

What the card renders follows the seat, because the seat decides who draws the frame. On
the row the page draws the card surface, the title, the row id and the expand control
before it mounts this view, so the bundle renders a body: our shell, our 14×14 chevron
and the `<ul>` that carried the shell's `<li>` are gone rather than nested inside the
Host's card, which is the second frame next to a first-party row that this decision
removes. The fields mount as soon as the row opens; the `unsaved` marker moved with the
header that used to hold it and now stands beside Save and Discard. The staged drafts,
the field-granular writes fenced by the revision read at the moment of writing, and the
per-field reset to the composition layer are unchanged. An unresolved namespace no longer
renders nothing: a card that owns its shell can stay invisible, while a body in the page's
frame would leave the reader inside an opened row with no section and no reason, so it
answers with one status line. And the focus ring is built from the Host's
`--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, each with a fallback, on every
control this bundle draws — the Host's `focus.css` suppresses a hard-coded outline under
pointer modality at a specificity a rule of ours cannot answer without fighting it, and
raising ours is the wrong repair.

Three further details follow from the new seat rather than from a redesign. The seat is
entitled to two views: `{ view: 'page', form }` for the
configuration section, and `{ view: 'summary' }` for the row's one-liner. The second is a
fallback, and for a published bundle it is normally not reached: the page writes
`description ?? renderSlot(…)` into the row's `<p>`, and the row's description comes from
the installed manifest's `description` field, which this package declares — as
`docs/DSH-0.1.7-MIGRATION.md` §4.2 records at both render sites
(`PluginManagerPage.tsx:495` and `:491`). The answer is kept because a row that declares
nothing is owed one, and it is kept *equal to that manifest field*, so the same row cannot
read one way from the inventory and another from its card; the two tests that drive this
entry compare the reply against the manifest rather than against a copied literal, so a
manifest edit reddens them instead of leaving the two sentences apart. What the entry does
with the page view is pick a component per view where it registers, rather than returning
early inside the card: that is what keeps each view its own hook order, and what keeps the
one-liner a line of text that reads no settings state and mounts no element instead of a
second live copy of the form in the page's heading. The card's own text
still arrives through the translate function the page binds for the locale namespace this
entry declares — and that is the only copy this entry used to hold itself: the tab's
`label` was the one string this bundle translated outside the card, so the bundle stopped
binding its own translator and the fallback dictionary it kept for that label went with
it. The seat and the join key are spelled as literals in the registration call rather than
reached through a constant, because the card contract reads which surface a bundle sits on
off the built bundle, and a registration that names its seat in the call is the statement it
can read; the same contract is what now holds this bundle to *no* shell, where it once
required one.

The seat hands over three things the entry used to spell by hand, and the manifest now
carries the packages that say them: `@deepseek-ai/dsh-client-ui-plugin-manager` merges
the row seat's owner contract into the slot table, `@deepseek-ai/dsh-client-ui-slots`
composes the entry's props from it, and `@deepseek-ai/dsh-client-ui-renderer` is the
half that assembles them at render time. All three arrive as peer and dev dependencies
in the shape `dsh-model-safety-gate` (#653) already uses, and none of them is a runtime
import: the card's props are now `PropsRuntime<"plugins.row.config"> & InjectFace<…> &
PropsLocale<"dsh-doc-impact">` rather than an interface this package wrote, so the
`view` discriminator, the page's `form`, the bound `useDocImpactCard` hook and the `t`
seat are read from the declarations that hand them out. That closes the question this
review round kept open — whether the page really delivers a translator to a keyed seat.
It does, and not by hope: the renderer synthesizes `t` for exactly those entries whose
registration declares a `locale:` namespace, and refuses the slot assembly with a
`SlotAssemblyError` when no locale face stands (`dsh-client-ui-renderer/lib/client.js`,
`standardKit`). A fallback translator would therefore be unreachable code standing in
for a failure the Host already reports, so the entry takes `t` as the definite prop the
composition says it is, and the dictionary's keys are merged into `LocaleNamespaceMap`,
which makes the key domain of `t` this card's own dictionary rather than any string.

The browser half does now depend on the Plugins page existing, and says so —
`compatibility.json` lists `plugins.row.config` among the required client features,
which is why this is `minor` rather than `patch`: a browser on a host without that page
loses the card. The losing is quiet, and that is the registration seam's doing rather
than the card's: `slots.inject` runs its callback when the slot already stands and
otherwise inside the declaring `register()` (`registry.d.ts`), so on a host that never
declares this page the callback is never reached and the `register` that would throw on
an undeclared slot is never called.
`tests/client-bundle.test.ts` reads the seat key and the settings
namespace from `cordis.patch.yml` rather than repeating them, so a row id that moves in
the patch reddens the test instead of quietly dropping the configure control, and it
drives the entry through both views the page asks this seat for — the page view mounting
the body and reading settings exactly once, the summary view answering as text with no
settings read at all. The page view is rendered with the page's own `form` prop present
and poisoned on both of its halves, because the card deliberately takes nothing from it:
the seat hands a `{ state, mutate }` whose `state` is one snapshot the page took while it
rendered, and a card that has to follow a write it did not make reads and fences the
document through the `ConfigForm` it resolves itself. The same test asserts the injected
face carries no member named `form`, which is the sentence the previous paragraph
argued for and nothing pinned until now: the renderer spreads the owner props after the
face, so a face member of that name would be shadowed by the page's narrower form and
the card would stop seeing its own without going red anywhere. The same file now records
the calls the entry makes against the Host's services and holds that the dictionary is
filed with the locale service under exactly the namespace the registration declares, and
*before* the seat is handed over: the card keeps no fallback translator, so a
`locale.register(…)` that went missing or moved behind the registration would show the
operator raw keys — `enabledLabel`, `saveFailed` — while every string the bundle gates on
still matched.
`tests/client-render.test.ts` runs
its field-by-field render through that registered entry as well as through the card, so
an entry that stopped forwarding the props the card draws with is a missing control on a
screen, not a comment, and both files fail if the body grows a frame or a toggle of its
own again.
`scripts/verify-client-bundle.mjs` checks values, not the spellings of the constants
that spell them: the slot literal, the full joined key the patch composes, the
`view === "summary"` branch the page depends on, the Host's ring token on the
controls this bundle draws, this package's own retired shell classes, and the absence of
the `settings.plugins.tab` seat this card vacated. Whether the bundle carries a shell it
no longer owns is the shared contract's rule to enforce, and it picks that rule from the
seat it reads off the bundle — which is why the seat is named in the registration. Both
that gate and the test now reach the patch through one parser, `scripts/patch-row.mjs`,
which parses the YAML instead of matching it and requires the one row every bundle patch
in this repository declares: two copies of a first-`id:`-wins pattern were two chances
for a second row to shift the key out from under a check that would still have gone
green.

One thing the card does differently from the first card on this seat. `#653` claims its
row unconditionally; this bundle used to claim its seat only while
`configForms.whileServed([SETTINGS_NS], …)` reported the namespace served, and it now
claims it unconditionally too. The watch is built for a page editing a namespace
*another* plugin owns — its callback fires from the `settings.describe` mirror — and that
mirror answers `unavailable` as the terminal state of a non-loopback page, where the
settings directory is deliberately not exposed. So gating on it hid the row's configure
control in exactly the browser AGENTS.md names for a card seated on the Plugins panel
("keeps answering from a non-loopback browser, where the settings directory is
intentionally unavailable … disable the write controls instead of hiding the card"). Per-
namespace reads do not pass through that directory: `get` answers a form for any entry
id, and the form's own snapshot says whether a document stands under it, which is where
the body already answers — a status line for a namespace nothing resolved, disabled
controls for a connection that keeps preferences process-local. `tests/client-bundle.test.ts`
holds this by never serving the namespace and expecting the seat anyway.

What the acceptance rests on, and what it does not. "The card opens from the Plugins panel
and saves" is proven by the built bundle and by the two tests that drive the entry it
registers — the seat key, both views, one settings read — and by a value read back under
the same namespace it was written in before the move. It is not proven by a click on the
operator's stand, and on a locked QA stand it cannot be: that page calls
`pluginInventory/list` and `pluginManager/listBundles|listPlugins`, and all three answer
403 there, because `pluginManager` also exposes `inspect`/`installBundle`/
`setPluginEnabled` to the remote surface, and opening those is the owner's call rather
than a plugin's (`docs/DSH-0.1.7-MIGRATION.md` §4.3). The focus ring is answered the same
way — in code, every control this bundle draws taking the Host's token pair with a
fallback on each half — and a browser still has to confirm it.
