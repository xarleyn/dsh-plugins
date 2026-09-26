---
"@yadsh/dsh-answer-review-gate": patch
---

The gate attributes its steers to its own producer kind and builds against a 0.1.7-rc.2 host.

The revision and failure-policy messages the gate puts back into the reviewed
agent were attributed to a catch-all `plugin` source kind. `0.1.7-rc.2` does not
define one: the source map — the harness's answer to *who produced this*, kept
separate from the `notice`/`snapshot`/`catalog` vocabulary that answers *what
kind of thing it is* — ships only `user`, `model`, `tool` and `system-prompt`,
and every other producer declares its own kind through a module augmentation
(`tool-registry`, `subagent-settled`, `model-selection`). Naming a kind the host
deleted is a compile error, so the package did not build against an rc.2 host at
all; and a kind no declaration carries would leave a consumer with nothing to
match the row against, falling through to opaque content.

The package now declares `answer-review` as its own source kind and steers under
it. The form it already used is rc.2's vocabulary unchanged — a `notice` with a
bounded one-line account — so a steered row still reads "Answer review requested
corrections (round 1 of 2)" instead of unlabelled text, and which candidate the
gate reviews, when it suppresses an interim turn, and what it steers are all
untouched. What changed is that an rc.2 host can say who wrote the message.
