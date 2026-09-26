---
"@yadsh/dsh-model-safety-gate": minor
---

The gate's configuration becomes live Host configuration, and its card moves to
the surface that still exists on a 0.1.7-rc.2 host.

On 0.1.5 the plugin installed a `model-safety-gate` settings namespace of its
own and the card edited that. `0.1.7` deleted the namespace surface: a field is
editable while the plugin runs iff its schema node is declared volatile, and the
settings namespace of a form is the profile entry id. So the twelve nodes the
card edits are now declared `.volatile()`, the card binds to
`dsh-model-safety-gate`, and the gate reads its configuration through the
references the Host resolves — `snapshotSafetyGateConfig` takes one snapshot per
reload, and `loader/volatile-update` is what announces a committed edit. **A
configuration the operator stored under the old `model-safety-gate` namespace is
not read by this version**: the Host imports legacy settings by entry id, and the
gate's own namespace was never one. The deployment keeps whatever its profile
patch declares and re-applies the rest from the card.

The write path changed shape with it. `SettingsRegisterOptions.validate` is gone
and the Host enforces only the schema, so a combination the schema cannot say —
a `dsh` backend without a provider, a `customBlockPatterns` entry that does not
compile — is stored, then refused where it matters: the gate keeps running its
last workable configuration, logs `safety.config.rejected`, and reports the
refusal as `configRejected` on the `safetyGate` Remote, which the card now shows
next to the controls. A silently ignored policy would be the failure mode worth
avoiding in a safety gate, so nothing is swallowed and nothing is blocked.

The card itself keeps its shell and moves to `Settings → Plugins → Model Safety
Gate` (the surviving `settings.plugins.tab`), the placement `AGENTS.md`
prescribes for a feature-owned page backed by a Remote; `settings.plugin.item`
no longer exists. Its list element keeps a list of the plugin's own, and writes
carry the revision the card read, so an edit that raced the surface is refused
rather than overwritten.
