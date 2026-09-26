---
"@yadsh/dsh-qa-integrations": patch
---

The shell of the operator card and every shared control it mounts now name
themselves, so a check reaches a knob by the settings key it writes rather than
by the caption printed above it.

The sections of the card already answer to a zone id; the fields inside them did
not. A field was found by the text of its label, an override mark by a BEM
class, the reset button and the layer badge by the exact sentence they render.
That copy is the operator's own handle — it is Russian, and a reworded hint is
an ordinary documentation change — so each such edit silently broke a check that
had nothing to do with the wording. Epic #453 asks for a handle that survives
both a rewritten caption and a switched language.

A control's id is derived from the path the Host stores its value under and the
card mutates by: `qa-integrations-enabled`, `qa-integrations-gitlab-max-file-bytes`,
`qa-integrations-bitrix24-crm-read`. The parts of a field hang off that id with a
suffix (`-field`, `-row`, `-remove`, `-add`, `-overridden`, `-deployment-select`),
and a node a field repeats keeps the id of its template, so the rows of an
instance editor read alike and a run tells them apart by their place in the list
rather than by a number baked into a name. ASCII kebab-case, one zone in the
prefix, and it is the same zone the sections already use; a field that has to
share its path with a sibling can name itself through the new `testId` prop
instead of colliding with it. The badge, the loading line, the write error, the
read-only banner, the toolbar and the reset button of the card body answer to
`qa-integrations-<what-it-shows>`.

Only attributes were added — every element, `className`, role and aria attribute
of the two files is what it was, so the card looks and reads exactly as before.
The card's own tests moved to the new handles where they had used a caption or a
class as the locator, and each assertion on a role or an accessible name stayed:
a field is still checked to carry its label, so an id and a caption cannot drift
apart unnoticed. The change is not user-visible, so the patch plan carries no new
QaChangelog section.
