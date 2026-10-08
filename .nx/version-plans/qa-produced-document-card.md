---
"@yadsh/dsh-documents": patch
"@yadsh/dsh-qa-surface": patch
---

A document the chat made arrives as a file, not as a path.

A stand that was asked to build a Word document built it and then said nothing
about it: the answer was a paragraph, the files tab said the chat had no
attachments, and the only trace of the artifact was a line of text the model had
copied out of a tool result — `/workspace/work/.qa-users/<account>/.qa/artifacts/…`,
which is the container's own layout and the account directory inside it. A chat
whose dialogs are readable by other accounts of the same server has no business
printing that.

The producing tools now report each file by its path inside the session
workspace — the same spelling their own input parameters accept, so a document
reported by one call is read back by the next — and the pipeline's absolute
paths stay where containment is checked, inside the runtime. The chat reads
those names out of the turn's tool results and cards the file under the answer
that made it: badge, name, size, `Открыть` into the workspace viewer with its
Word preview, `Скачать` for the bytes. The card is on the roster of the files tab
too, so the answer's document is listed with what the chat sent. It appears
whatever the tool-activity switch hides, because a file the reader asked for is
not tool noise, and where the Host refuses workspace reads the card still names
the file without offering a control that would be refused. An answer that quotes
an absolute path anyway — one written before this change, replayed from durable
history, or rebuilt by a model from the working directory it was given — is
projected with the workspace directory and the account partition masked out.
