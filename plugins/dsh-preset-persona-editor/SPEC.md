# SPEC — @yadsh/dsh-preset-persona-editor

A settings page that edits one field of an agent preset: the persona
`@deepseek-ai/dsh-persona` composes for the sessions that preset starts.

The persona is not a new concept and this plugin does not introduce one. DSH
agent presets are already compositions, and a preset that names
`@deepseek-ai/dsh-persona` already carries its own system-prompt text. What was
missing is a way to change that text without hand-editing `agent.cordis.yml`.
This plugin is that editor: it reads the row, writes the row, and owns no
prompt plumbing of its own.

## 1. Product contract

Numbered, testable guarantees for version 0.1.0:

1. **Role is the preset.** The feature adds no `role → prompt` mapping beside
   `preset → persona`. A preset's persona is the persona its sessions get, and
   the plugin never composes, injects, or rewrites a system prompt at runtime.
2. **The composition is the only source of truth.** Persona values live in the
   preset's own `agent.cordis.yml`. Nothing is copied into `settings.yaml`, and
   no second store is created; uninstalling the plugin leaves every edited
   preset working exactly as edited.
3. **Surgical writes.** A save replaces the four values it owns and not one
   byte more: comments, `!!js` expression scalars, `{{cwd}}`/`{{model}}`
   templates, block-scalar chomping, sibling rows, and the file's own line
   endings and byte-order mark all survive untouched.
4. **Only user-owned presets are writable.** A preset the deployment ships
   (`trust: system`) is refused with `preset-persona/read-only`. The refusal is
   by trust, the roster's own criterion — never by guessing a path.
5. **Revision guard.** Every read returns a content revision (a hash of the
   file's bytes). A save must present it back; if the file changed since, the
   write is refused with `preset-persona/conflict` and both revisions, and the
   external edit survives.
6. **A refusal writes nothing.** Malformed YAML, a persona row whose managed
   key is an expression, more than one persona row, a complete persona with an
   empty prefix, or a value over the byte ceiling all refuse before the file is
   touched. The new text is re-parsed and read back before the replace, so a
   rendering fault refuses instead of producing an uncomposable preset.
7. **Complete is explicit and disclosed.** `complete` is never set silently:
   it is a checkbox, it is off by default, and while it is on the page states
   that this persona replaces the agent's other system-prompt sections.
8. **`includeRuntimeContext` defaults to true**, matching the plugin it writes.
9. **Reset removes the override; it does not copy a parent.** Reset deletes the
   preset's persona row, so the deployment's own persona applies again. It is
   never a copy of another preset's values, and it is idempotent.
10. **Inherited is a first-class state.** A preset with no persona row is shown
    as inherited (the deployment's persona applies), not as an empty text.
11. **Unmanaged keys are preserved and disclosed.** A persona row that also
    carries keys this editor does not own (an older composition's spelling, for
    instance) keeps them across a save, and the page lists them. Reset removes
    the whole row and says which keys go with it.
12. **Ambiguity is refused, not guessed.** A composition naming more than one
    persona row — including one nested in a group — is reported and cannot be
    written by this plugin.
13. **Public extension points only.** The host half registers a service and a
    Typert Remote namespace; the browser half registers a `settings.section`
    page. No DSH package is patched, and no React component is monkey-patched.
    The roster is read through `ctx.agentPresets`, never by scanning
    directories on its own.
14. **Peer-only runtime.** All `@deepseek-ai/*` packages are peer dependencies.
    The YAML parser and the Remote codec are ordinary library dependencies of
    the plugin.
15. **Sessions are not rewritten.** A save changes presets, not running
    sessions: the harness reads a composition when a session starts. The page
    says so rather than pretending otherwise, and the plugin has no access to
    session history at all.

## 2. Data model

- `PersonaDraft` — `prefix`, `suffix`, `complete`, `includeRuntimeContext`,
  exactly the config `@deepseek-ai/dsh-persona` accepts.
- `PersonaPresetRow` — one roster row: id, display name, description, trust,
  is-default, editability, broken reason, persona state (`none` | `local` |
  `ambiguous` | `unreadable`), `complete`, revision.
- `PersonaDocument` — one opened preset: the four values, the file's path and
  revision, its unmanaged and unrewritable keys, the source text, the number of
  composition rows, and the section orders the deployment resolves for the
  persona prefix and suffix.

## 3. Lifecycle

1. Open the page: the roster is read through the `agentPresets` service; every
   preset's composition is read from disk (unmemoized — it is a live
   directory).
2. Open a preset: its values, its unmanaged keys, and its revision are read.
3. Edit and save: values are validated, the revision is checked, the row is
   rewritten in place (or inserted when the preset has none), the result is
   re-parsed and read back, and the file is replaced atomically.
4. Reset: the row is removed through the same guard, so the preset inherits the
   deployment's persona again.
5. After any write the page re-reads the preset and the roster, so what is on
   screen is what is on disk — including a revision conflict, which reloads
   rather than merging.

## 4. Scope

### Included (0.1)

- Reading a persona out of the selected preset, and the roster's persona state.
- Editing `prefix`, `suffix`, `complete`, `includeRuntimeContext`.
- Inherited/custom indicators, reset, and the two preview readings.
- Revision-conflict detection and the read-only refusal for shipped presets.
- Copying a shipped preset into the user's own presets, so it can be edited.

### Deferred

- An advanced prompt-sections editor (`ctx.systemPrompt` ordered sections).
- Editing any other preset row (tools, skills, sandbox) through this page.
- A preset's `preset.yml` metadata (name, description, order).
- Model routing, permission profiles, tool visibility, subagent routing, and
  any other composition field: they belong to the preset, not to this page.

## 5. Required end-to-end scenarios

Every one of these is covered by the test suite:

1. a preset without a persona row (inherited);
2. a preset with a prefix only;
3. prefix plus suffix;
4. `complete: true` (written, and read back);
5. `includeRuntimeContext: false`;
6. an inherited persona shown as inherited, and materialized on save;
7. reset removing the local override rather than copying a parent;
8. an external modification between read and save (conflict, file intact);
9. a malformed composition (refused, nothing written);
10. a shipped/read-only preset (refused, nothing written);
11. uninstall safety: the plugin's presence is not required for an edited
    preset to work — the edit is plain composition YAML.

## 6. Implementation status

| Area | State |
| --- | --- |
| Host service (`presetPersonaEditor` Remote: list, read, save, reset, copy) | Implemented |
| Composition surgery (in-place rewrite, insert, remove; comments/`!!js`/EOL/BOM preserved) | Implemented |
| Revision guard, read-only refusal, validation refusals | Implemented |
| Browser page (`settings.section`, roster, editor, preview, file viewer) | Implemented |
| Package gates (manifest, bundle, compatibility, tarball) | Implemented |
| Live check on a running deployment | Pending: see the handoff recipe in the README |

The page has been exercised through its own unit and wiring tests; it has not
yet been opened against a running DSH web deployment from this repository's CI,
which runs no browser.
