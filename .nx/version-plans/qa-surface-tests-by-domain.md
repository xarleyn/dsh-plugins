---
"@yadsh/dsh-qa-surface": patch
---

The QA surface's own tests are filed by the area of the stand they check, following the shape `dsh-qa-integrations` got in b13e13e.

Two hundred and eight test files and twenty shared helpers sat in one flat `tests/` directory. The area a file belongs to was carried by its name prefix, and that prefix had stopped agreeing with the tree a long time ago: `provenance-*`, `qa-admin-console-*`, `accounts-*` and `session-*` files were neighbours, and finding the test that covers a behavior meant scanning the whole listing rather than opening the folder the behavior lives in. The suite had also grown past the point where a name-only convention holds: two hundred and eight entries in one column is not a table anyone reads.

The domain folders now carry that information instead — access, accounts, admin, client, config, enforcement, integration, personal-skills, prompt-notes, provenance, qa-tools, questions, routing, scripts, session, slash, transcript, wiring, and a helpers folder. Two groups of latecomers are folded in here: the provenance host files, which landed flat after the first cut, and the notifications and message-queue tests that reached `tests/` from main afterwards. Those now sit under `client/notifications`, `client/components`, `config` and `session`, each next to the module it drives.

Nothing is re-asserted: no test body, helper, or expectation was rewritten, only paths and the relative specifiers that resolve them. The suite runs the same — two hundred and thirty-two files, one thousand seven hundred and eighteen tests — and no test file is left at the top level, which is the measure this card was opened with.
