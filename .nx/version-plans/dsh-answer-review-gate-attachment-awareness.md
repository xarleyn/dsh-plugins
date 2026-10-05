---
"@yadsh/dsh-answer-review-gate": patch
---

A reviewer no longer treats an attachment it cannot open as proof that the
answer invented its content.

The gate handed the reviewer two strings — the request and the draft — because
the text collector kept only text blocks, so a question asked about an uploaded
report or a photo reached the reviewer with the attachment erased. The reviewer
was instructed that a lack of evidence is a valid finding, so it raised exactly
the finding it could not avoid, and since an expert finding carries no concrete
fix to apply, the loop had no way to converge: the round budget ran out and the
answer was delivered as-is with a disclaimer. That is the shape of the
`max-rounds` failures the stand counts.

The reviewer now receives the same handle lines the host shows a model that
cannot receive the file — a named attachment, its kind, and no read path — and
the protocol in both shipped reviewer prompts says what follows from that: an
attachment you cannot inspect is reported as unverifiable, never as a
fabrication. The bytes are still not passed; giving the reviewer the file
itself needs a read tool in its allow-list and an image-capable reviewer model,
which is a separate decision.
