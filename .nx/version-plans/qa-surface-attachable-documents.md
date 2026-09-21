---
"@yadsh/dsh-qa-surface": patch
---

Attachments take the documents the stand can read, not only text files.

`attachments.extensions` was a list of *text* extensions in every sense: the
constant, the normalizer, the settings label and the refusal copy all said so.
A deployment whose document pipeline reads Word and PDF therefore still refused
a `.docx` at the composer, with a message that named a fixed set ("md, txt, log
и другие") which had nothing to do with its own configuration — the visitor
could see the stand render that very document in the files panel while being
unable to hand one over.

The list is now what its name implies. Accepted extensions are the files the
stand can work with, `docx` and `pdf` join the text files in the default set, a
refusal names the extension it refused and says the operator owns the list, and
the settings card calls the pair what they are ("Файловые вложения" and
"Разрешённые расширения файлов"). A deployment that pins its own list keeps it
exactly as written, which is why the operator-facing wording matters: an empty
or text-only list is now visibly a narrowing rather than the only shape the
setting can take.
