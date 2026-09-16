---
"@yadsh/dsh-qa-surface": patch
---

Send the answer ratings a user gives to the Host instead of dropping them in
the browser.

The rating control files an answer under its durable log position, and the
client projection dropped that position: `emitTurn` rebuilt the assistant
message from its collected parts and carried the id, text, timing and turn
stats, but never `seq`. The browser therefore had no position to file a rating
under, `QaMessage` called back without one, and the surface's own guard
returned before making a request — no RPC, no warning, and the 👍/👎 state
written to `localStorage` first, so the control kept showing the user's choice
while `qa-quality.json` stayed empty. Every rating a user gave since per-message
feedback shipped was lost this way, and with it the reviewer's feedback list,
the derived review queue's negative signal, the quality metrics, and the
positive/negative counters on a user's activity card.

The projection now carries the log position onto the answer it emits, and an
answer that somehow reaches the surface without one reports the loss in the
console rather than looking filed.
