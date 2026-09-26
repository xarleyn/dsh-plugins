---
"@yadsh/dsh-openviking-memory": patch
---

The memory plugin configures itself live on harness 0.1.7-rc.2.

The 0.1.7 settings rewrite folded a plugin's profile configuration and its
browser-editable namespace into one thing: a field is an editable form field
exactly when its schema node is marked volatile, and the settings namespace is
the profile entry id. Every knob of this plugin's `static Config` carries that
mark, so the Host now serves the namespace on its own and the plugin's
registration call — the settings section it installed through a host service
that no longer exists — is gone. The consequence for an operator is the same
promise, kept a different way: a switch edited in the card is re-read at the
start of the next thing a session asks, reaches the sessions that are already
open, and lands in the running runtime. Clearing a field still falls back to the
composition entry rather than to a built-in default.

The card moved with the surface it sits on. `settings.plugin.item` was deleted
with no replacement slot of the same shape, so the card registers as a tab of the
Plugins settings section instead — which is also where the plugin's own shell
belongs, since that section hands a registrant an empty column: the card keeps
the `dsh-plugin-card` shell and the `<li>` root now sits in a list the plugin
owns. Nothing about the controls, the override markers or the write path changed.

Session start moved too. The `agent/session-start` event no longer exists; the
startup profile is delivered from `agent/created`, whose listeners the host
awaits and where a throw rolls agent creation back. The plugin now reports every
failure of that read in its log instead of raising it, so an unreachable
OpenViking server cannot stop a chat from opening — and because the host awaits
the listener, the profile is in the context before the first step rather than
racing it.

Injected context finally names its producer the way the host asks: the catch-all
`plugin` source kind was removed and the source map is open for each producer to
extend, so the plugin's profile and recall blocks are attributed to
`openviking-memory`. Sessions whose history was written before this release carry
the old attribution, and the "this chat already has its profile" check still
recognises it — a resumed chat does not get a second profile. Capture reads only
what the source map says is conversation, so a `developer/message` carrying the
`tool-addition` / `tool-removal` blocks the host started emitting at `rc.2`
neither reaches memory nor pollutes a recall query; those three rules are pinned
by tests.
