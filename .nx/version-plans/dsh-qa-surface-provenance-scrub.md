---
"@yadsh/dsh-qa-surface": patch
---

Remove internal project identifiers from the shipped sources and fixtures. The
provenance specification (`docs/*.md` ships in the tarball) and the provenance
test used a real Jira project key, a real task title and real product and
document names in its examples; they now read `PROJ-24929` with placeholder
titles, a generic product path and a generic knowledge-base page. Only the
example content changed — the provenance contract, the source-kind table and
the worked walkthroughs describe exactly the same behaviour.
