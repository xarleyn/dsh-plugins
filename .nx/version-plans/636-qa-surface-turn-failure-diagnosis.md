---
"@yadsh/dsh-qa-surface": patch
---

A turn the Host ended in failure says which failure it was, in the chat and in the stand's log.

The terminal row was one sentence for every failure the Host does not own localized copy for, so a stand whose provider adapters never registered — each turn ending `NO_ADAPTER`, the answer never written — looked exactly like a transport hiccup: «Помощнику не удалось завершить ответ.» The code and the provider it names were in the session journal, which is a zstd archive nobody opens over an operator's shoulder, and in neither the chat nor the plugin's daily log, where the round's tool warnings were the only lines. Every such case became a manual decode.

The row of a failure without its own copy now carries its code, because the code is the handle an operator greps the log with. `UNKNOWN` is left out: it is what the Host writes for anything that is not a provider failure, so naming it promises a diagnostic that does not exist. A missing adapter gets its own sentence rather than the code alone, because the one thing a tester would otherwise try — asking again — cannot repair a registry the Host never filled.

On the Host, a turn closed with an error is recorded as `session.turn-failed` with the session id, the turn, the failure code and the provider the request was routed to. The provider comes from the session's folded request header, not from the provider's message: that message is free text, and a provider can echo a credential inside it, so no part of it is written. Delegated experts resolve through the ownership map, so a chat that died inside one of its own subagents is recorded too, and the console mirror carries the line out of the log file into the container's stdout.
