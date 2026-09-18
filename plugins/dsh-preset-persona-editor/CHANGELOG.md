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