# @yadsh/dsh-preset-persona-editor

Edit an agent preset's persona — its system-prompt prefix and suffix, complete
mode, and runtime-context toggle — from the DeepSeek Harness settings UI,
without hand-editing the preset's `agent.cordis.yml`. An advanced area edits the
prompt sections the preset contributes in its own name.

The page appears in Settings as **Persona**, right beside the deployment's own
**Agent Presets** page, and edits the same thing that page composes: the
rows of a preset composition.

## Features

- **One card per preset**, with an `Inherited` / `Custom` / `Shipped` badge, so
  it is visible at a glance which presets carry their own persona.
- **Prefix and suffix editing** with the persona's own semantics: the prefix
  replaces the deployment's persona prefix for this preset, the suffix renders
  after the first-party guidance.
- **Complete mode** with an explicit warning that this persona then replaces the
  agent's other system-prompt sections; never enabled silently.
- **Runtime context toggle** (`includeRuntimeContext`, on by default) for a
  persona that should not receive the dynamic sandbox/approval snapshots.
- **Prompt sections (advanced)** — a preset can contribute named, ordered
  sections of its own: name, order, text, and an `enabled` switch. A section
  registered under a first-party name (`deployment:*`, `tool:*`, …) shadows that
  section for this preset's sessions. The list is data in the composition row;
  the preset ships a small registrar (`prompt-sections.mjs`) that mounts it, so
  the sections keep working with this plugin uninstalled, and a hand-edited
  registrar is never overwritten.
- **Preview** of both what will be written (the exact YAML blocks) and where the
  persona and the sections land in the assembled prompt, ordered by the
  harness's own section vocabulary.
- **Surgical writes.** The preset's comments, `!!js` expressions, `{{cwd}}`
  templates, sibling rows, line endings, and byte-order mark survive every edit;
  only the values this page owns move.
- **Revision guard.** A save that races an external edit is refused with both
  revisions and reloads, instead of overwriting someone else's change.
- **Reset** removes the persona row, returning the preset to the deployment's
  persona; a shipped preset is never written at all, and can be copied into your
  own presets for editing.

The persona and the sections are stored where they belong: in the preset.
Uninstalling this plugin leaves every preset you edited working exactly as
edited.

## Install

```sh
dsh plugin --profile web add @yadsh/dsh-preset-persona-editor
```

From a checkout of this repository:

```sh
pnpm install
pnpm --filter @yadsh/dsh-preset-persona-editor build
dsh plugin --profile web add ./plugins/dsh-preset-persona-editor
```

Restart the deployment (or reload the browser page) and open
**Settings → Persona**.

## Configuration

The plugin takes its configuration from its row in the deployment composition:

```yaml
- id: dsh-preset-persona-editor
  name: "@yadsh/dsh-preset-persona-editor"
  config:
    allowComplete: true
    maxPersonaBytes: 262144
    maxSections: 32
    maxSectionsBytes: 262144
```

| Field | Default | Meaning |
| --- | --- | --- |
| `allowComplete` | `true` | Whether `complete` may be written at all. With `false`, the complete-mode toggle is refused with an explanation, so a deployment can forbid replacing the whole system prompt. |
| `maxPersonaBytes` | `262144` | Ceiling for prefix plus suffix, in bytes. A larger persona is refused. |
| `maxSections` | `32` | How many prompt sections one preset may contribute. |
| `maxSectionsBytes` | `262144` | Ceiling for the section texts together, in bytes. |

All four are enforced on the host; the page only reports the refusal.

## What a preset with sections looks like

```yaml
- id: prompt-sections
  name: ./prompt-sections.mjs
  config:
    sections:
      - name: team:style
        order: 2500
        text: |-
          Answer in the user's language.
          Prefer small, reviewable changes.
        enabled: true
```

`prompt-sections.mjs` is a small registrar the plugin writes into the preset
directory (it is created on the first save that adds a section). It reads the
row's list and registers each enabled section through `ctx.systemPrompt`, which
is what makes a section of this preset shadow a deployment-global section of the
same name. It imports nothing from this plugin, so the preset keeps composing
with the plugin uninstalled — and because it is code, the editor never rewrites
it: if you edit or replace that file, the page says so and keeps writing the
list only.

## How the write behaves

- A save rewrites the values inside the existing rows, inserting missing keys,
  creating a row when the preset has none, and removing the sections row when
  the list is emptied.
- Keys the editor does not manage are preserved and listed on the card; reset
  removes them together with the persona row (the page says which ones).
- A persona row whose managed key is set to a `!!js` expression, a sections list
  that is not a plain block sequence, or a composition naming more than one of
  either row, is reported and refused rather than rewritten.
- Saving an untouched, inherited preset writes nothing at all: the editor does
  not create empty rows.
- Changes apply to **new sessions**: DSH composes an agent from the preset it
  names when the session starts, and a running session keeps the composition it
  began with. The page states this instead of implying a live swap.

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0` (tested against `0.1.5-rc.2`).
- Requires the deployment to mount `@deepseek-ai/dsh-agent-presets` (the
  `agentPresets` service) and `@deepseek-ai/dsh-system-prompt`.
- Client surface: `settings.section` and the Typert Remote namespace
  `presetPersonaEditor`.
- Node `^22.19.0 || >=24.0.0`.

## Development

```sh
pnpm install
pnpm --filter @yadsh/dsh-preset-persona-editor check
```

`check` runs lint, typecheck, the test suite (composition surgery, the file
layer, the service's wire surface, the page's store and wiring, and the built
browser bundle), the build, and the package gate.

To try it against a local deployment, build the package, add it to a profile,
and restart that deployment — the host half is loaded from the composition and
the browser half is served as `/plugins/@yadsh/dsh-preset-persona-editor/client.js`.

## License

MIT. See [LICENSE](./LICENSE).
