---
"@yadsh/dsh-preset-persona-editor": minor
---

Initial release: a settings page that edits an agent preset's persona.

The harness already lets a preset carry its own persona — a
`@deepseek-ai/dsh-persona` row inside the preset's `agent.cordis.yml` — but
until now changing that text meant editing the composition by hand. This plugin
turns the capability into a page: pick a preset, edit the prefix and suffix,
toggle complete mode and the runtime-context switch, and save. The page appears
in Settings beside the deployment's own Agent Presets section, and it adds no
prompt plumbing of its own: the persona a session receives is still composed by
`dsh-persona` from the preset, so uninstalling the editor leaves every edited
preset working exactly as edited.

The write is surgical. A save replaces the four values the editor owns and not
one byte more, so a composition's comments, `!!js` expression scalars,
`{{cwd}}`/`{{model}}` templates, block-scalar chomping, sibling rows, line
endings, and byte-order mark all survive. Shipped presets are refused by the
roster's own trust, a save that races an external edit is refused with both
revisions instead of overwriting it, and every other refusal — malformed YAML,
a managed key set to an expression, more than one persona row, a complete
persona with an empty prefix, a value over the byte ceiling — happens before
the file is touched. Reset removes the row rather than copying another preset's
values, which is what returning a preset to the deployment's persona means.
