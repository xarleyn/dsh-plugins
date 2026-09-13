---
"@yadsh/dsh-qa-surface": minor
---

Let a QA visitor attach text files, not just images. A composer attachment is
now one of two kinds: an image still rides the prompt inline as base64, while a
file is staged on the Host through the browser upload service first and the
prompt cites the returned receipt. The Host stores the file verbatim and its
prompt assembly hands the model the name, the size and the read-only path of
the stored copy, so a `.md`, `.txt` or `.log` reaches the model through the
same handle every other attachment does.

Pasted plain text over a line threshold becomes an attachment instead of a wall
of text in the input field. `attachments.pastedTextLines` (default 200) sets
that threshold and `0` turns the conversion off; the resulting file is named
after its line count, e.g. `Вставленный текст (312 строк).txt`. Everything
shorter pastes into the field as before.

The `attachments` config section carries the rest of the policy:
`textFiles` switches file intake off entirely (images remain), `maxFileBytes`
caps one file, `maxPending` caps images plus files on one message — replacing
the compiled-in limit of eight images — and `extensions` names the accepted
text extensions. A file whose extension is not listed is still accepted when
the browser reports its type as `text/*`, so an empty list narrows the intake
rather than closing it.

The settings card gains a "Вложения" section for all five fields, and the
transcript renders a sent file as an extension badge, its name and its size.
Files are never readable back through the attachment route (that route serves
images), so the sent row shows the same handle the model resolves.

In the per-user workspace mode the monotonic path guard now exempts read-only
access to a single file under the mounted attachment store's root. Uploaded
copies are immutable, content-addressed and live outside every workspace, so
without that exemption the model would be denied the exact file the prompt
points it at. Directory-wide tools stay confined, because the store is shared
by every account, and writes are never exempted.
