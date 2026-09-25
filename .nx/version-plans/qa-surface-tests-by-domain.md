---
"@yadsh/dsh-qa-surface": patch
---

The QA surface's own tests are filed by the area of the stand they check, following the shape `dsh-qa-integrations` got in b13e13e.

Two hundred and eight test files and twenty shared helpers sat in one flat `tests/` directory. The area a file belongs to was carried by its name prefix, and that prefix had stopped agreeing with the tree a long time ago: `provenance-*`, `qa-admin-console-*`, `accounts-*` and `session-*` files were neighbours, and finding the test that covers a behavior meant scanning the whole listing rather than opening the folder the behavior lives in. The suite had also grown past the point where a name-only convention holds: two hundred and eight entries in one column is not a table anyone reads.

The domain folders now carry that information instead — access, accounts, admin, client, config, enforcement, integration, personal-skills, prompt-notes, provenance, qa-tools, questions, routing, scripts, session, slash, transcript, wiring, and a helpers folder. The last flat leftovers were the provenance host files, which landed after the first cut; they moved in this change, together with the import specifiers that pointed at their old neighbours.

Nothing is re-asserted: no test body, helper, or expectation was rewritten, only paths and the relative specifiers that resolve them. The suite runs identically — two hundred and seventeen files, one thousand five hundred fifty-nine tests — and no test file is left at the top level, which is the measure this card was opened with.
