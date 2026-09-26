---
"@yadsh/dsh-tool-offload": patch
---

The parent-context test injects its fake context under a source kind the host
actually has.

The suite simulated a non-human user-role message with `kind: "plugin"`. No such
producer exists at `0.1.7`: a message's source map is `user`, `model`, `tool` and
`system-prompt`, which each producer extends with its own kind, and `plugin` sits
on neither axis. The fixture now names `time-context`, a host package that really
does prepend a user-role message to the turn, so the case asserts what its name
promises.

Nothing in the extractor moved. `source.kind === "user"` stays the only human
producer, and because the map is merge-extensible the guard has to fall through
unfamiliar kinds rather than carry a list of them — which is why its comment and
the test header no longer say "plugin-injected".
