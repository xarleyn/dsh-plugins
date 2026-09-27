# SPEC — @yadsh/dsh-preset-persona-editor

A settings page that reads what an agent preset contributes to the prompt: the
persona `@deepseek-ai/dsh-persona` composes for the sessions that preset starts,
and — in an advanced area — the named, ordered sections the preset contributes
in its own name.

Neither is a new concept, and the plugin does not introduce one. DSH agent
presets are already compositions, and a preset that names
`@deepseek-ai/dsh-persona` already carries its own system-prompt text. What this
page adds is a reading of it next to the deployment's own Agent Presets page, in
the vocabulary the composition itself uses.

## 0. What the 0.1.7-rc.2 cutover took away

Up to `0.1.5` the page also wrote: it spliced the persona row and the sections
row into the preset's `agent.cordis.yml`, guarded by a content revision, and
could copy a shipped preset into a user-writable root so it could be edited.
Since `0.1.7-rc.2` the Host has no durable preset-authoring path: the roster's
`authorable` flag and its `copy` operation were deleted, not relocated
(`docs/DSH-0.1.7-MIGRATION.md` §8.6). Owner decision D2 of §10 settled what the
plugin does about it — read, and nothing else — and issue #605 blocks the return
of persona edits to the screen.

Guarantees 3, 4, 5, 6, 9, 16, 17 and 18 below are **withdrawn**: not
implemented, not deferred. They stay on this page because they are the contract a
restored write path has to meet again, and one commit is what brings them back.
The rest still holds.

## 1. Product contract

Numbered, testable guarantees:

1. **Role is the preset.** The feature adds no `role → prompt` mapping beside
   `preset → persona`. A preset's persona is the persona its sessions get, and
   the plugin never composes, injects, or rewrites a system prompt at runtime.
2. **The composition is the only source of truth.** Persona values live in the
   preset's own declaration. Nothing is copied into `settings.yaml`, and no
   second store is created; uninstalling the plugin changes nothing about what
   any preset composes.
3. ~~**Surgical writes.**~~ **Withdrawn** — there is no write. The composition
   surgery that did it is still shipped and still tested: it replaced the four
   values it owns and not one byte more, so comments, `!!js` expression scalars,
   `{{cwd}}`/`{{model}}` templates, block-scalar chomping, sibling rows, and the
   file's own line endings and byte-order mark all survived.
4. ~~**Only user-owned presets are writable.**~~ **Withdrawn**, together with
   the `trust` that criterion rested on. It was always a refusal by trust, the
   roster's own criterion, never by guessing a path — and the page still guesses
   nothing.
5. ~~**Revision guard.**~~ **Withdrawn** — no write to guard. Every read used to
   return a content revision (a hash of the file's bytes), a save had to present
   it back, and a race was refused with both revisions.
6. ~~**A refusal writes nothing.**~~ Withdrawn as a write guarantee. The rules
   still answer, through the exported validators and the reader's disclosures:
   malformed YAML, a persona row whose managed key is an expression, more than
   one persona row, a section list the harness could not mount.
7. **Complete is explicit and disclosed.** Where a persona carries `complete`,
   the card says so and the outline marks every other section as suppressed; the
   value is never inferred from anything else on the row.
8. **`includeRuntimeContext` defaults to true**, matching the plugin it reads.
9. ~~**Reset removes the override; it does not copy a parent.**~~ **Withdrawn.**
10. **Inherited is a first-class state.** A preset with no persona row is shown
    as inherited (the deployment's persona applies), not as an empty text.
11. **Unmanaged keys are disclosed.** A persona row that also carries keys this
    page does not describe lists them — preserved and reported when the page
    could write, reported only now.
12. **Ambiguity is reported, not guessed.** A composition naming more than one
    persona row — including one nested in a group — is reported, and the page
    shows no single persona for it.
13. **Public extension points only.** The host half registers a service and a
    Typert Remote namespace; the browser half registers a `settings.section`
    page. No DSH package is patched, and no React component is monkey-patched.
    The roster is read through `ctx.agentPresets`, never by scanning directories
    on its own.
14. **Peer-only runtime.** All `@deepseek-ai/*` packages are peer dependencies.
    The YAML parser and the Remote codec are ordinary library dependencies of
    the plugin.
15. **Sessions are not rewritten.** The page changes nothing, running or future.
    DSH composes an agent from the preset it names when the session starts, and a
    running session keeps the composition it began with; the page says so rather
    than implying a live swap. The plugin has no access to session history.
16. ~~**Sections are the preset's own code, not the plugin's.**~~ The promise
    stands by the preset rather than by this page: a preset with sections
    composes with this plugin uninstalled, because the registrar is the preset's
    own module. The page no longer materializes it.
17. ~~**The registrar is never rewritten.**~~ **Withdrawn** — nothing is
    rewritten, and since the composition arrives rendered from the preset's
    declarations, the file beside it is not something this page can see at all.
    What a preset declares as its sections is what the page reports.
18. ~~**Section data is validated where the harness would fail.**~~ Withdrawn as
    a gate on a write. The rules are the harness's own — a name is a single-line
    identifier unique within the preset, an order is a whole number, a text is
    non-empty — and are still tested through `validateSections`.
19. **Ordering is the harness's, and shadowing is stated.** The preview places
    the sections by the harness's own order vocabulary, and the page warns when
    a section name belongs to a first-party section, because a section
    registered in a preset's scope shadows the deployment-global one.
20. **Reading does not enforce the harness's uniqueness rule.** The reader drops
    a section with no name and keeps every other row it can parse, so a
    composition edited by hand may declare two sections under one name. The page
    shows both rows, each with its own values, and says nothing about the
    duplicate: the collision is the preset's fact and the harness's to refuse,
    and this page has no write left to refuse it with.
21. **A roster a refresh failed to update is not presented as current.** The
    rows stay on screen — a refused `list()` is not a deployment that composes
    no presets — and the refusal is put above them. Nothing else on this screen
    can carry it: the page records no timestamp for the list it shows, so the
    words explaining why the rows did not change are the only claim it can make
    about their age. The notice carries the control that dismisses it — a
    message the page holds for the user is theirs to put down, and navigating
    into a preset is not the same as reading it.

## 2. Data model

- `PersonaDraft` — `prefix`, `suffix`, `complete`, `includeRuntimeContext`,
  exactly the config `@deepseek-ai/dsh-persona` accepts.
- `PersonaPresetRow` — one roster row: id, display name, description,
  is-default, broken reason, persona state (`none` | `local` | `ambiguous` |
  `unreadable`) and `complete`. An `0.1.7-rc.2` roster row publishes no
  ownership and no path, so neither reaches this model.
- `PersonaDocument` — one opened preset: the four values, the roster's broken
  reason, the reason a composition could not be read (`""` when it could), its
  unmanaged keys, the composition text the Host rendered, the number of
  composition rows, and the section orders the deployment resolves for the
  persona prefix and suffix. The broken reason and the read reason are separate
  fields on purpose: `readDocument` renders a broken preset's declarations too,
  so one does not imply the other.

Both reasons are the host's text, passed through untouched, and the page has one
rule about what it puts in front of a browser: the registry's own refusals name
identities, not locations. Measured against the installed `0.1.7-rc.2` class,
driven over a hand-seeded definition rather than trusted from its types —
`agent-preset/not-found` answers `Unknown agent preset: <id>` with the roster's
ids in `details` and never resolves `undefined`, and the `broken` line is
`<entry id> (<plugin name>): <mount failure>` built by the registry's own audit;
the Loader it audits adds nothing but entry ids to its messages. A deployment
therefore shows on this page exactly the text its own `agentPresets`
`list`/`read` Remotes already answer to any client, which is why no field is
re-worded here. What the page writes itself are the two refusals a host owes no
words for: no `readDocument()` in the compatibility range, and an answer that is
not a composition.

## 3. Lifecycle

1. Open the page: the roster is read through the `agentPresets` service, and
   every preset's composition is read through it as well — one render per
   preset, awaited together rather than one after another, since the page shows
   only the state each one came back with (unmemoized — the roster is a live
   directory, and a cached answer would be the one that goes stale when a preset
   is registered or retired). A composition the registry refuses is logged with
   the host's reason and the row is badged `Unreadable`.
   A refresh that fails over a list already on screen keeps the rows — dropping
   them would answer a refused `list()` with a deployment that composes nothing
   — and carries the refusal into the notice the roster screen renders: the
   rows it keeps are stale precisely because the refresh failed, and `status`
   staying `ready` means nothing else on this screen can say it.
2. Open a preset: its values, its unmanaged keys, and the composition the
   registry renders for it are read, and nothing else happens.
3. There is no step 3. The page has no write, so there is no revision check, no
   readback, and no atomic replace.

## 4. Scope

### Included

- Reading a persona out of any preset in the roster, and the roster's persona
  state.
- Inherited / custom / ambiguous / unreadable indicators and the preview
  readings.
- The advanced area as a reading: the named, ordered sections a preset
  contributes, whether each is enabled, and their place in the assembled prompt.
- The disclosures a hand-edited composition needs: keys beyond the four, a
  managed key set to an expression, more than one persona row, and the reason
  the registry gives for a preset that cannot compose.
- The composition text itself, for every case the four fields cannot hold.

### Not included (since the 0.1.7-rc.2 cutover)

- Writing any value: no save, no reset, no copy. The Host has no durable
  preset-authoring path — decision D2, and issue #605 for the return.
- Editing the registrar module's code from the page (it is the preset's file).
- Editing any other preset row (tools, skills, sandbox) through this page.
- A preset's metadata (name, description, order).
- Model routing, permission profiles, tool visibility, subagent routing, and
  any other composition field: they belong to the preset, not to this page.

## 5. Scenarios the suite covers

1. a preset without a persona row (inherited);
2. a preset with a prefix only, and one with prefix plus suffix;
3. `complete: true` read back, with the outline marking the rest suppressed;
4. `includeRuntimeContext: false`;
5. a malformed composition, reported with the reason instead of a page of
   defaults;
6. a composition naming more than one persona row, reported as ambiguous;
7. a persona row carrying keys this page does not describe, and one setting a
   managed key to a `!!js` expression — each disclosed;
8. uninstall safety: the plugin's presence is not required for any preset to
   compose — the persona is plain composition YAML and the sections are a module
   the preset owns;
9. a preset the registry reports as broken — the roster's own reason reaches the
   card, and the readings are shown beside it: a preset that cannot activate
   still declares a composition, and `readDocument` renders it regardless;
10. a composition the registry refuses outright — no readings, and the reason is
    the host's own words rather than this page's guess, with the same refusal
    reaching the deployment log;
11. a host that answers the composition read with no composition — a deployment
    inside the `<0.2.0` half of the range that publishes no `readDocument()`, or
    one that resolves a value carrying no text. Each is refused in the page's
    own words, and never as the `TypeError` that reading the answer further
    would have thrown;
12. a preset the roster does not know, answered with the page's own not-found
    code and the Host's reason logged beside it;
13. the ordering and shadowing warnings of a section named `deployment:*`;
14. a roster refresh refused over the rows it keeps — asserted on the rendered
    page, not only in the controller, because the store's `error` belongs to the
    screen that draws when there is no list at all, and a message written where
    the ready screen reads nothing is a stale roster passing as a current one.
    The notice is then dismissed by its own control, pressed by name: a state
    the page keeps for the user has to be one they can put down, and a method
    only its own test reaches is not that control.

## 6. Implementation status

| Area | State |
| --- | --- |
| Host service (`presetPersonaEditor` Remote: list, read) | Implemented |
| Composition reading (persona row, sections row, unmanaged keys, ambiguity) | Implemented |
| Composition surgery (in-place rewrite, insert, remove; comments/`!!js`/EOL/BOM preserved) — a library with no caller since the cutover | Implemented, tested |
| Section and draft validation rules — a library with no caller since the cutover, and the reason `preset-persona/invalid` is still declared: it is what this library throws | Implemented, tested |
| Preset state the registry publishes (broken reason, default id, display name) | Implemented |
| Browser page (`settings.section`, roster, readings, advanced area, preview, composition viewer) | Implemented |
| Package gates (manifest, bundle, compatibility, tarball) | Implemented |
| Writing a preset through this page | Withdrawn (decision D2; issue #605) |
| Live check on an `0.1.7-rc.2` deployment | Not done — the last live pass was against `0.1.5-rc.2`, and this repository ships no deployment to open one in. What it owes is the card in three states — a preset read cleanly, one the roster calls `broken`, one whose composition read the registry refused — beside a first-party card, because `client-editor-markup.test.tsx` pins the markup a screen reader reads and the margin each block resets, not the spacing a person sees |

The page was exercised against a live deployment at `0.1.5-rc.2`: the roster, a
save into a composition that uses a folded scalar, reset, a save from the
inherited state, the revision conflict, the read-only refusal, and copying a
shipped preset. The advanced area was proven end to end in process — the plugin
wrote the sections, the harness mounted the preset, and `systemPrompt.assemble`
for that preset's scope returned the section text, with a disabled section
absent. None of that is re-verified against `0.1.7-rc.2`, and the writes it
describes are gone.

What an eye in a browser would have caught — the name each reading carries after
the `<label>`/`<p>` round trip, and that one refusal answers with one sentence —
is pinned by `tests/client-editor-markup.test.tsx`, the only test in the package
that renders the client at all. A live pass would still be the one that shows a
real deployment's registry behaving as its published types say.
