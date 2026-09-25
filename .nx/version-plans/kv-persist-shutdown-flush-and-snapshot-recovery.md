---
"@yadsh/dsh-kv-persist": patch
---

A KV snapshot now survives both the shutdown it was written for and the restore
that failed.

Shutting DSH down discarded the conversation state the plugin had promised to
keep. The disposal sequence announced itself as disposed before asking the
coordinator for the final checkpoint, and the checkpoint saw that announcement
and stepped aside, so a session whose last turn was still unsaved was never
saved. Nothing complained: the snapshot simply described a conversation one turn
shorter than the one the user closed the session with. The shutdown checkpoint
now runs through its own path, still refused to everything that wants to start
new work, and it still waits behind an inference stream that has not finished so
it sees the turn that stream produced.

A snapshot that failed to come back could never come back again. A restore
failure marked the manifest invalid, which is right, and every later save then
rewrote the snapshot file underneath that manifest while leaving it invalid — so
the plugin kept saving work it would never read, and each new session started
cold no matter how many snapshots it had written. A successful save now returns
its manifest to the ready state and drops the reason, including after the runtime
fingerprint changed, where the saved bytes belong to the new runtime and the
manifest said otherwise.
