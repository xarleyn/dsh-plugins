---
"@yadsh/dsh-qa-surface": patch
---

The QA admin console became addressable from a browser run, so driving it no
longer requires naming the Russian labels it paints.

The console is the most clicked surface of the plugin and the least reachable
one: a check found the delete control, the row's «Открыть», the reset queue's
«Сбросить», a priority cell or the collapsed tool calls by the string rendered
beside them, and the console shell itself by a BEM class. Copy is the weakest
handle a page offers — it is localized, it is reworded without changing any
behaviour, and a filter's label is exactly the line a maintainer edits when the
filter stops matching what operators search for. This is the admin-console round
of epic #453.

Every node a run reaches now carries a `data-testid`: the shell and the
navigation (`qa-admin-root`, `qa-admin-nav-<section>`), each page
(`qa-admin-overview`, `qa-admin-conversations`, `qa-admin-review-queue`,
`qa-admin-quality`, `qa-admin-audit`, `qa-admin-users`, `qa-admin-user-card`,
`qa-admin-memory`), and inside them the controls, the state chips and the row and
cell hooks. Filters and paging are named first, because they are what a copy
edit breaks: one id per filter (`qa-admin-conversations-filter-from`,
`qa-admin-users-filter-role`, `qa-admin-memory-filter-expert`, …) and one
`qa-admin-pager` with its `-count`, `-more` and `-reset` controls, shared by
every paged list. Values are ASCII kebab-case with the zone in the prefix, and a
repeated node keeps the value of its template — the rows of a table, the badges
of a message, the buckets of the effective-access tab all read alike, and which
one is meant stays the run's business, told apart by the accessible name or the
place in the list the node already had. Explanatory prose is deliberately left
unnamed: an id marks a control, a state or a shell, not a sentence.

Only attributes were added. No element moved, no class changed, and no `role` or
`aria-*` attribute was touched, so the console looks and reads exactly as it did.
The console's own checks moved to the new handles wherever they had used visible
text or a class as the locator — the metric a counter row paints, the transcript
and its collapsed tool calls, the refusal of a deletion, the priority and reason
of a queue item, the password-reset queue and its field, the memory rows and
their editor, the skill table's health and its blocked verdict, the role card's
counts, the console shell in the routing checks — while every assertion on a role
or an accessible name stayed where it was. The namespace picker and the review
form's problem options are still reached through the name a screen reader reads,
which is the coverage the epic asks to preserve.
