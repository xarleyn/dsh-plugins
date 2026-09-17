# @yadsh/dsh-preset-persona-editor

Edit an agent preset's persona — its system-prompt prefix and suffix, complete
mode, and runtime-context toggle — from the DeepSeek Harness settings UI,
without hand-editing the preset's `agent.cordis.yml`.

The page appears in Settings as **Persona**, right beside the deployment's own
**Agent Presets** page, and edits the same thing that page composes: the
`@deepseek-ai/dsh-persona` row of a preset composition.

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
- **Preview** of both what will be written (the exact YAML block) and where the
  persona lands in the assembled prompt.
- **Surgical writes.** The preset's comments, `!!js` expressions, `{{cwd}}`
  templates, sibling rows, line endings, and byte-order mark survive every edit;
  only the four persona values move.
- **Revision guard.** A save that races an external edit is refused with both
  revisions and reloads, instead of overwriting someone else's change.
- **Reset** removes the persona row, returning the preset to the deployment's
  persona; a shipped preset is never written at all, and can be copied into your
  own presets for editing.

The persona is stored where it belongs: in the preset. Uninstalling this plugin
leaves every preset you edited working exactly as edited.

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
```

| Field | Default | Meaning |
| --- | --- | --- |
| `allowComplete` | `true` | Whether `complete` may be written at all. With `false`, the complete-mode toggle is refused with an explanation, so a deployment can forbid replacing the whole system prompt. |
| `maxPersonaBytes` | `262144` | Ceiling for prefix plus suffix, in bytes. A larger persona is refused. |

Both are enforced on the host; the page only reports the refusal.

## How the write behaves

- A save rewrites the four values inside the existing persona row, inserting
  missing ones and creating the row when the preset has none.
- Keys the editor does not manage are preserved and listed on the card; reset
  removes them together with the row (the page says which ones).
- A persona row whose managed key is set to a `!!js` expression, or a
  composition naming more than one persona row, is reported and refused rather
  than rewritten.
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
