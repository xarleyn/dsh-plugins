---
"@yadsh/dsh-jev-compaction": minor
---

The settings card edits the plugin's own configuration, and lives in a Plugins tab.

Before `0.1.7` a plugin held its configuration twice: the profile entry the
runtime read, and a separately installed settings section the browser card wrote,
glued together by `installSection` callbacks that pushed one into the other. The
rewrite deleted that seam — `ctx.settings` is now `SettingsForms`, with no section
to install — and unified the two: a field is editable live exactly when its
schema node carries `.volatile()`, and the namespace the Host serves it under is
the plugin's own profile entry id.

So the thirty-one fields this card edits are volatile now, the plugin reads one
detached snapshot of them at the start of each operation instead of keeping a
copy, and a committed change reaches the running plugin through
`loader/volatile-update` rather than through an `onChange` hook the plugin handed
to the Host. The section install is gone, and what replaces it is the presentation
choice the Host stopped making for us: the plugin declines the automatically
generated page, because it ships a card of its own.

Two visible consequences. The card is a tab of **Settings → Plugins** now, since
the `settings.plugin.item` slot it registered in was deleted; it keeps our shell
(decision D1 of the cutover). And the stored namespace is `dsh-jev-compaction`,
the entry id from `cordis.patch.yml`, instead of the invented `jev-compaction` —
a user override written under the old name is not carried over, because the Host
never stored it in the place the new model reads from.

The card's write path is otherwise the same card: the same controls, the same
per-field override markers and resets, the same claim that only the *name* of the
API key variable crosses to the browser. `ConfigFormSnapshot` exposes the three
layers `SettingsScope` did, so the card body kept its reads and swapped only the
mutation call.

The block taxonomy moved too, and this part the compiler was willing to describe.
A `tool/result` message no longer wraps its blocks in one tool-result block: the
blocks sit directly under the message and the call identity and outcome flag
became message fields, which simplifies the single-node replacement the plugin
writes. The `0.1.7` host also started *emitting* `tool-addition` and
`tool-removal` blocks, and no type error announces those: a replacement built
from the first block alone could silently discard a registry change. A new test
records why it cannot — the Host admits those blocks on developer messages only,
so they are unreachable from the mutation domain — and another that a developer
message sitting on the surface is skipped by collection and state building rather
than misread.

Separately, the backend-mode entry now forwards `headroomTokens` to the compaction
engine it extends. Its `Config` is deliberately `z.any()` — the inherited schema
would strip the companion sections — which meant a key that belongs to the
inherited engine was unreachable in a profile. `0.1.7`'s engine validates the
headroom against the routed model's context window, so a small-window deployment
could no longer compact at all and had no way to say so.
