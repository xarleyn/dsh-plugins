# @yadsh/dsh-preset-persona-editor

Read what an agent preset contributes to the prompt — its system-prompt prefix
and suffix, complete mode, runtime-context toggle, and the named sections it
registers in its own name — from the DeepSeek Harness settings UI, without
hand-editing the preset's composition.

The page appears in Settings as **Persona**, right beside the deployment's own
**Agent Presets** page, and reads the same thing that page composes: the rows of
a preset composition.

It reads, and does not write. Since DeepSeek Harness `0.1.7-rc.2` the Host has
no durable preset-authoring path — the roster's `authorable` root and its `copy`
operation were deleted, not relocated — so this page reports what a preset
composes rather than changing it. The decision is D2 of
`docs/DSH-0.1.7-MIGRATION.md` §10, and the blocker for returning persona edits
to the screen is issue #605.

## Features

- **One card per preset**, with an `Inherited` / `Custom` / `Shipped` badge, so
  it is visible at a glance which presets carry their own persona.
- **The persona's four values** in the persona's own semantics: the prefix
  replaces the deployment's persona prefix for this preset, the suffix renders
  after the first-party guidance.
- **Complete mode**, with the warning that this persona then replaces the
  agent's other system-prompt sections — stated wherever it is found on.
- **Runtime context** (`includeRuntimeContext`, on by default) shown per preset:
  whether its sessions receive the dynamic sandbox/approval snapshots.
- **Prompt sections (advanced)** — a preset can contribute named, ordered
  sections of its own: name, order, text, and an `enabled` switch. A section
  registered under a first-party name (`deployment:*`, `tool:*`, …) shadows that
  section for this preset's sessions. The list is data in the composition row;
  the preset ships a small registrar (`prompt-sections.mjs`) that mounts it, so
  the sections keep working with this plugin uninstalled.
- **Preview** of the persona and the section list in the YAML shape the
  composition carries, and of where they land in the assembled prompt, ordered by
  the harness's own section vocabulary.
- **The composition itself**, for the cases this page can only describe: a row
  that carries keys beyond the four, a managed key set to a `!!js` expression, or
  more than one persona row in one preset.

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

The plugin takes no configuration: it writes nothing, so it has no ceilings to
enforce. Its row in the deployment composition is the plain two-field entry the
install command above creates.

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

`prompt-sections.mjs` is a small registrar the preset carries beside its
composition. It reads the row's list and registers each enabled section through
`ctx.systemPrompt`, which is what makes a section of this preset shadow a
deployment-global section of the same name. It imports nothing from this plugin,
so the preset keeps composing with the plugin uninstalled — and it is code, so
this page never reads it as data: it reports the list the composition names and
says whether the registrar file is the one this editor ships or a hand-written
one.

## What the page shows

- The persona's four values as the composition carries them, plus the section
  list, in the same YAML shape a hand edit would use.
- Keys the page does not describe: a persona row that carries more than the four,
  a managed key set to a `!!js` expression (whose value is not the text shown),
  or more than one persona row in one preset — each is named on the card,
  because then no single value is "the" persona.
- The composition text itself, for every case the four fields cannot hold.
- Presets apply to **new sessions**: DSH composes an agent from the preset it
  names when the session starts, and a running session keeps the composition it
  began with. The page states this instead of implying a live swap.

## Compatibility

- DeepSeek Harness `>=0.1.7-rc.2 <0.2.0` (tested against `0.1.7-rc.2`).
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
