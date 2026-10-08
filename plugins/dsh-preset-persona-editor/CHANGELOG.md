## 0.2.1 (2026-10-08)

### 🩹 Fixes

- Every plugin row on the Host's Plugins page is named in words. ([fff88762](https://github.com/xarleyn/dsh-plugins/commit/fff88762))

  The page titles a bundle's row and fills its description line from the package's
  exported `locale/en.json`, which the Host resolves through the package's `exports`
  map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
  Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
  their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
  first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
  `locale/*.json`, and carries English `meta.title` and `meta.description`; where the
  package already had a configuration card, its `summary` one-liner and the row's
  description are one string, pinned by a test against the shipped file rather than
  against a copy in the test. `pnpm verify:packages` asks all three halves of every
  plugin package, so a row cannot fall back to a specifier unnoticed.

  Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
  panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
  row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
  namespace the Host serves the form under, so no saved value is orphaned — and with the
  seat it gives up its shell, its header badge and its show/hide labels, taking the
  Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
  unavailable namespace with a sentence instead of an empty section.
  `dsh-domain-experts` owns no form — it edits domains through its Remote services — so
  it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
  drops the `<h2>` heading and the intro line the panel already draws from the row's own
  display metadata.

### ❤️ Thank You

- xarleyn

## 0.2.0 (2026-10-04)

### 🚀 Features

- The persona page reads presets through the `0.1.7-rc.2` preset registry, and it no longer writes them. ([#518](https://github.com/xarleyn/dsh-plugins/issues/518), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  The Host renamed the package behind `ctx.agentPresets` — `@deepseek-ai/dsh-agent-presets` became `@deepseek-ai/dsh-agent-preset-registry` — and the face it publishes is not the one this plugin was written against. A roster row carries `{id, name?, description?, order?, broken?}`: the `trust` that said whether a preset belongs to the deployment and the absolute `path` of its `agent.cordis.yml` are gone, and so are the `authorable` flag and the `copy` operation that let this editor duplicate a shipped preset into a writable root. The capability was deleted rather than relocated (`docs/DSH-0.1.7-MIGRATION.md` §8.6), so owner decision D2 of §10 is what this release implements: the plugin becomes a reader, and the blocker for bringing persona edits back is #605.

  The read half now asks the registry instead of the file system. `list()` gives the roster, `defaultId` marks which preset a session naming none composes, and `readDocument(id)` returns the child plugin list rendered from the preset's own declarations — the effective composition, not a file's bytes, so a preset's comments and hand formatting are the Loader's business and the page says it shows a rendering. `broken` is a fact the page states in the registry's own words, which the old `trust` badge had no room for, and it stays separate from whether the page has anything to read: `readDocument` renders a preset's declarations without consulting the activation diagnostic, so a preset that cannot compose a session still declares a persona, and the page shows it rather than denying it. Refused reads are no longer folded into an answer this page invented — the registry's reason reaches the card and the deployment log, including the case the compatibility range permits and the face does not: a registry that answers no `readDocument()` says so, instead of leaving every row silently unreadable.

  Gone from the wire and from the browser: the `save`, `reset` and `copy` operations of the `presetPersonaEditor` namespace, the revision guard (a comparison of the revision a save presented with the file's own bytes, which #356 measured losing two saves of one revision: both passed the check before either renamed the file, so it guarded the file's bytes and not the write, and what returns has to hold one composition exclusively across the whole read, check and write), the `path`/`trust`/`revision` fields, the `editable` flag that answered three different failures with one boolean (and so could only be described by one sentence, which fitted none of them), the registrar-file state the page could only know by holding the composition's path, the draft-and-dirty editing model with its Save/Revert/Reset/Copy controls, and the four configuration ceilings (`allowComplete`, `maxPersonaBytes`, `maxSections`, `maxSectionsBytes`) whose only job was to gate a write — so the plugin declares no Config now, the way `dsh-session-scope`'s read service already does, and `@deepseek-ai/schemastery` leaves its peer list with it. The fields the page kept are the ones a rendered composition still answers: the persona's four values, the section list, the unmanaged keys, `!!js`-valued managed keys, extra persona rows, and the composition text itself.

  The composition surgery and the section validation rules stay shipped and stay tested. They are the package's public library, they are what a restored write path re-attaches to, and keeping them out of this change is what leaves the write-half removal in one commit — though that commit does not revert on its own: replayed over the read-path migration it conflicts in 20 paths (17 content, 3 modify/delete) at `296b8836`, the last code commit of this series, and the `preset-writer.ts` it restores reads `readPresetFile`, `revisionOf` and `preset.path`, all three of which this migration deleted. A reversal of decision D2 is therefore a revert of the whole #518 series, and `docs/DSH-0.1.7-MIGRATION.md` §10 says so where #605 will read it. What left instead is what the writer owned and nothing else read once it was gone: the registrar source this page used to lay beside a preset's composition, the list comparison its dirty-check ran, and the `busy` flag its Save button set. Two events are new in the deployment log — `preset-persona.read-refused` and `preset-persona.composition-refused`. The reader answers its own not-found code so a client has one failure to branch on; both events carry the reason the registry actually gave, which used to be dropped at that conversion and at the composition read alike. A refusal the host answers for every preset — a registry that publishes no `readDocument()`, or one that answers it without a composition — is stated once for the rows it covers rather than once per row, so a deployment with N presets logs one line about its registry where it used to log N on every visit to Settings.

  The card shell is untouched. This page mounts in `settings.section`, which survives `0.1.7-rc.2` unchanged, so decision D1 does not reach it: the `dsh-plugin-card` classes, the header button with its `aria-expanded` and label, and the 14×14 SVG chevron are as `AGENTS.md` specifies them, and the bundle still asserts them. Inside the shell, each reading is tied to its control by `for` and its explanatory hint reaches the control as a description rather than as part of its name; a `jsdom` suite pins that markup, because nothing else in the package renders the client — the bundle test replaces the React creators with a no-op — so until it these were checks for an eye. The roster's composition reads now run together instead of one after another on every page load. A roster refresh that fails over the rows already on screen keeps those rows and puts the reason above them: the page stamps no age on the list it shows, so those words are the only claim it can make that the rows are the last ones it read, and before them the refusal went into a field the screen drawing a list never renders — a stale roster presented as a current one. That notice carries a dismiss control of its own: the page keeps the message for the user, and navigating into a preset is not the same as having read it. The screen also carries the control that asks the roster again — **Reload the roster** — because a row the registry reports as waiting on a service that has not mounted yet becomes healthy by itself, and the page that read it once was holding that refusal until the settings section remounted; the reader's own Reload still re-reads the open preset only. What reaches the screen keeps its shape: the registry answers a preset that cannot activate with a tree of causes, and the tree arrives with the line breaks the host wrote it with — its first line names the row that refused on the closed card, where the card shell has room for one line, and every line is what the opened card states. The two switch readings are reachable now: they were `disabled`, which drops a control out of the tab order and left `complete` and `include-runtime-context` undiscoverable to a keyboard reader, and they are `aria-disabled` with the composition's value pinned instead, which says the same thing to a person without hiding the value from them. The published `README.md` points at the migration guide and at the package specification through the repository rather than by path, since the tarball ships neither and a reader on npm had two pointers to places they could not go. And the rename left nothing dangling behind it: the two `@deepseek-ai/dsh-agent-presets` keys in `pnpm-workspace.yaml`, whose only consumer this change renamed, are gone — a catalog key for a package that does not exist at `rc.2` is an invitation to pin a peer no install can resolve.

  The level is `minor`, and the reading that would have made it `major` is recorded here rather than left for the next release note to reconstruct. §9.3 of `docs/PLUGIN_GUIDELINES.md` puts an incompatible Remote-contract change and removed exports under `major`, and this release is both: `save`, `reset` and `copy` leave the `presetPersonaEditor` namespace, and `ConfigSchema`, `Config`, `savePersona`, `resetPersona`, `copyPreset`, `readPresetFile`, `revisionOf`, `readOnly` and `conflict` leave `src/index.ts`. What holds it at `minor` is one measured fact: no package this repository publishes has reached `1.0` — the highest is `dsh-qa-surface` at `0.13.0`, no `CHANGELOG.md` in the workspace carries a `1.x` heading, and no version plan filed here has ever declared `major` — so a `major` here would not mark the break, it would publish `1.0.0` and assert for one plugin the stability a platform still on its own `0.1.7-rc.2` does not claim. Below `1.0` the breaking step is the `minor`, which is what the sibling cut-over of this wave (#515) took for a removal of the same kind. `docs/RELEASING.md` derives the release from this file and chooses no bump type afterwards, so the word on the line above is the decision and not a suggestion; if the owner wants the break announced at `1.0.0`, it is that line which changes, and these sentences are what the change answers.


### 🩹 Fixes

- Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover. ([#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))

  `compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
  release, and the Requirements/Compatibility lines of the README and SPEC that
  restate that pair moved with it, so a package page and its manifest agree. The
  checks that hard-code the pair moved in the same change: two `deepEqual`
  assertions in the package verifiers, one bundle test, the plugin generator's
  scaffold defaults with its test, and the fixtures of the repository gates that
  read them.

  Dated records keep the version they were written against. Phase 0 and spike
  findings documents, `SPEC` baseline tags and permalinks into the harness tree,
  and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
  what was observed on that host rather than what the package supports now.

- The persona page names its own markup, so a test stops depending on its wording. ([#470](https://github.com/xarleyn/dsh-plugins/issues/470))

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

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- Qoder
- qoder-bot

## 0.1.2 (2026-09-22)

### 🩹 Fixes

- The preset page's package gate now asserts the settings-card shell it renders. ([b34b108](https://github.com/xarleyn/dsh-plugins/commit/b34b108))

  The page mounts inside the native settings tree instead of registering a
  `settings.plugin.item` card, so it draws the shared shell itself and nothing
  checked that it kept drawing it: its gate asserted the bundle's identity and
  that no node built-in reached it, but not one line of the shell contract. It now
  runs the same card contract the card plugins run.

  The contract itself gained the two assertions a stylesheet cannot carry. The
  canonical rules prove a bundle is *styled* like a card; a bundle that injects
  them and then draws its own outer shell — a `<div>` root, a header that is not a
  toggle — passed every one of them. The rendered open-state class pair and the
  header's `aria-expanded` are read from the bundle instead, so the shell has to be
  built, not just styled.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the package's oversized test files are split into per-domain ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  files with shared helpers (`prompt-sections`, `composition`, `client-store`,
  `preset-files`). No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-18)

### 🚀 Features

- Initial release: a settings page that edits what an agent preset contributes to ([4387ce6](https://github.com/xarleyn/dsh-plugins/commit/4387ce6))
  the prompt — its persona, and in an advanced area its own prompt sections.

  The harness already lets a preset carry its own persona — a
  `@deepseek-ai/dsh-persona` row inside the preset's `agent.cordis.yml` — but
  until now changing that text meant editing the composition by hand. This plugin
  turns the capability into a page: pick a preset, edit the prefix and suffix,
  toggle complete mode and the runtime-context switch, and save. The page appears
  in Settings beside the deployment's own Agent Presets section, and it adds no
  prompt plumbing of its own: the persona a session receives is still composed by
  `dsh-persona` from the preset, so uninstalling the editor leaves every edited
  preset working exactly as edited.

  The advanced area edits the other half of the same idea: the named, ordered
  prompt sections a preset contributes in its own name, each with an order, a
  text, and an `enabled` switch. Its mechanism is the harness's own — a
  `./prompt-sections.mjs` row whose registrar reads the section list from the
  row's config and registers it through `ctx.systemPrompt` — so a section of a
  preset shadows a deployment-global section of the same name, the registrar is
  dependency-free code the preset owns, and the sections survive this plugin being
  uninstalled. The plugin writes that registrar once, never rewrites it, and
  reports it if someone edited it by hand; removing the last section removes the
  row and deletes the file only when it is byte-for-byte the editor's own.

  The write is surgical. A save replaces the values the editor owns and not one
  byte more, so a composition's comments, `!!js` expression scalars,
  `{{cwd}}`/`{{model}}` templates, block-scalar chomping, sibling rows, line
  endings, and byte-order mark all survive. Shipped presets are refused by the
  roster's own trust, a save that races an external edit is refused with both
  revisions instead of overwriting it, and every other refusal — malformed YAML,
  a managed key set to an expression, more than one relevant row, a complete
  persona with an empty prefix, a section list that is not a plain block
  sequence, duplicate section names, a fractional order, a value over a byte
  ceiling — happens before the file is touched. Reset removes the persona row
  rather than copying another preset's values, which is what returning a preset
  to the deployment's persona means.

  Verified against a live 0.1.5-rc.2 deployment and in process: the plugin's own
  write path put a section into a preset, the harness mounted that preset, and
  assembling its prompt returned the section text at its declared order, with a
  disabled section absent.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn