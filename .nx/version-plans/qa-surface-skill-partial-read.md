---
"@yadsh/dsh-qa-surface": patch
---

A skill file the Host only read partly is reported as what it is, and a strict
skill stops losing on a tool its role already hands out.

`SKILL.md` is read up to a ceiling, so one oversized file cannot pin a
memory-bound Host. The read then presented the prefix as the document: the size
rule compared the loaded bytes against the ceiling they had just been cut to, so
the limit could not fire for the one file it exists for and the answer came back
valid, with no diagnostics. The revision was the hash of that same prefix, so an
append to the tail changed nothing a caller could see, and the contract's
`sha256(file bytes)` described only its head. The loss followed the edit: open
such a skill, change the body the editor was handed, save, and the serializer
wrote back what the draft held — everything behind the ceiling gone without a
word. The administrator badge broke on the same seam from the other side,
because a write records the hash of the whole text it wrote while a read answered
with the hash of what it had loaded.

The read now carries the file's real size and says plainly when it stopped
early: the size rule sees the bytes on disk, `skill-file-truncated` joins the
diagnostics, and the document is marked so the editor knows it is holding a part.
The revision is computed over the whole file, hashed through a bounded buffer, so
a change behind the ceiling moves it and a write built on the older revision is
refused as the conflict it is. Saving over a partly loaded document is refused
until the client says it knows the copy is incomplete: the editor asks once,
names what will be lost, and puts the confirmation on the second save. The
administrator sidecar keeps reading a truncated record as "no marks" — a lost
badge stays a lost badge, and the reason is now written down where that read
happens.

The strict-skill half is the same class of mistake. A requirement was checked
against the list of tools a grant may still ADD, and the capability policy
subtracts the role's own base set from that list — so a skill asking for `read`,
on a role that gives `read` to every chat, was told the tool was unavailable and
refused outright. What a session already holds now satisfies the requirement, and
only what it lacks goes through the ceiling and the mask.

The regressions: a file above the ceiling is checked for its diagnostics, for the
refused save, for the file it leaves untouched and for the save that proceeds once
confirmed, and a tail append is pinned to the revision it changes; two grant tests
cover a requirement the base set alone meets and one that mixes a base tool with a
grantable one, and a browser test drives the two save clicks.
