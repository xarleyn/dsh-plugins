---
"@yadsh/dsh-answer-review-gate": patch
---

A corrected answer arrives alone — the gate no longer makes the primary argue with its reviewer in front of the user.

On a live deployment the final answer of a reviewed turn opened with the internal exchange:
«Опровержение вывода ревизора: …» followed, further down, by the short line the user had asked for. Another run put the same
leak in a visible thinking block, where the model wrote down that its instructions asked it to keep the review quiet.

The revision steer was the cause. It demanded, in one sentence, that a disproved objection "state that disproof" and that the
answer never mention the review. A primary resolves that contradiction literally and prints the disproof as the answer — and
the reviewer's own vocabulary arrives with it, because it came from the same text. The instruction to conceal is what the
visible reasoning then reports.

The steer now admits exactly one visible artifact: the corrected answer, in the shape the user's request asked for. Findings
come back inside a delimited `<review_notes>` block, framed as this turn's working material rather than as prose to continue,
and a rejected objection is dropped without a word — the reviewer re-reads the next version of the answer, and where the
exchange repeats the round budget ends it under the configured failure policy. No rule is phrased as a secret any more.

As a guard, a candidate that opens by disputing the review is never handed to a reviewer and never passes: the primary is
steered once per user turn to deliver the answer's shape instead. A message the host has already committed cannot be edited at
this seam, so the guard stops the leak from being certified as verified rather than removing text the user has already read.
