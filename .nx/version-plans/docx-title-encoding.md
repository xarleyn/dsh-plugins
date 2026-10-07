---
"@yadsh/dsh-documents": patch
---

A generated DOCX opens with a title made of replacement characters no more.

`document_create` handed the document title and its metadata to Pandoc as
`--metadata=key=value` arguments, while the Markdown body went to the same run as a
file. A backend decodes the files it is given as UTF-8 and its own command line in
the locale the process runs under, so where no UTF-8 locale is set every byte above
0x7F of an argument arrives as U+FFFD. `«Отчёт по работе»` is fifteen characters,
twenty-eight UTF-8 bytes, twenty-six of them above 0x7F — which is exactly the
paragraph the stand produced: twenty-six replacement characters with the two spaces
left standing, while the section heading, the two paragraphs and the table, all read
out of `source.md`, came through intact.

Document text no longer rides the command line. The provider writes the title and the
metadata as a UTF-8 YAML file in the job's work directory and passes
`--metadata-file`, the channel the body already proved, for the DOCX renderer and the
Typst renderer alike; an explicit title still wins over the front-matter one. The work
directory is removed with the rest of the intermediates, so nothing of it survives
into the artifact bundle.

The regression test runs the provider against a stub that decodes its argv the way a
backend without a UTF-8 locale does, builds a real `word/document.xml` from the
metadata it received, and asserts that the Cyrillic title is in it and that no U+FFFD
is — so the class fails the test, not only the one string.
