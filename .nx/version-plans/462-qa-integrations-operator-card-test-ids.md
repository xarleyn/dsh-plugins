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
`qa-integrations-bitrix24-crm-read`. The zone sits in the prefix and the keys
follow it, spelled one way for every segment: camelCase comes apart, an acronym
run belongs to the word after it, and any other run of non-alphanumerics
collapses to a single dash, so `issues.read` is `issues-read` and no key can
hand back a selector the harness cannot quote. A provider's key already starts
with the provider, so those knobs land in the zone their section uses; a
top-level key (`timeoutMs`, `allowedPortalSuffixes`) sits right after the zone
and belongs to the general section by the schema, not by its name.

The parts of a field hang off that id with a suffix (`-field`, `-row`,
`-remove`, `-add`, `-overridden`, `-deployment-select`), and a node a field
repeats keeps the id of its template — the convention does not bake a row's
value into a name. A concrete row is the one carrying `data-dsh-row-key`, the
attribute the epic points a check at: the row of a stored instance is the node
keyed `corp`, not the first of however many the deployment happens to keep. A
field that has to share its path with a sibling names itself through the
`testId` prop instead of colliding with it, and the profile editor of the
service-access section is that field: its resource map and its deny map are
`qa-integrations-service-access-profile-<row>-resources` and `-policy`. The
badge, the loading line, the write error, the read-only banner, the toolbar and
the reset button of the card body answer to `qa-integrations-<what-it-shows>`.

Only attributes were added — every element, `className`, role and aria
attribute of the touched files is what it was, so the card looks and reads
exactly as before. The card's own tests moved to the new handles where they had
used a caption or a class as the locator, and each assertion on a role or an
accessible name stayed and tightened: a field is checked to carry exactly its
label, not a prefix of it, so an id and a caption cannot drift apart unnoticed,
and a run asserts that the ids answer once per scope and stay ASCII kebab-case.
The change is not user-visible, so the patch plan carries no new QaChangelog
section.
