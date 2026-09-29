---
"@yadsh/dsh-qa-integrations": minor
---

`jira_search_issues` can now search a field's history, not only the values an issue
carries right now.

«Побывали ли задачи в In Progress», «двигали ли статус за две недели», «переназначали
ли их на вот этого человека» were questions the tool could not answer: the filter
vocabulary read the current value of every field, and the only way to reach the past
was to read the changelog of one issue at a time — a question about a hundred issues
became a hundred reads. Jira answers these directly, with the `WAS` and `CHANGED`
history operators.

The operators arrive as a typed filter, `history`, because the rule that kept JQL out
of the model's hands was never about which operators are expressible: a clause is
still assembled by the provider from validated parts. `{ field, op, value, from, by,
on, after, before }` builds `status WAS "In Progress" AFTER -2w BEFORE -1w` or
`resolution CHANGED FROM "Отклонено" TO "Fixed" BY currentUser()`, and every part is
checked before it reaches the string — the field is one of the six Jira keeps a
searchable history for (a custom field is refused and pointed at `customFields`,
whose history belongs to the instance, not to this package), the operator is `was` or
`changed`, `was` needs the value it asks about, `from` belongs to `changed` alone, and
a single day (`on`) alongside a window (`after`/`before`) is a contradiction rather
than a preference. Values are quoted and escaped like every other filter, so an `OR
project = SECRET` written into a history value stays text inside quotes. A person in a
history clause is `me` or the identifier this product filters on — the change log of
the issue already shows it, so no user-directory read sits behind this path, which
keeps the service credential's resource boundary intact.

Nothing is assembled from a partially parsed entry: an unreadable clause is refused
with the keyword that broke it, because a quietly dropped bound answers a different
question and its answer reads like a fact about the issues. At most three clauses per
search, ANDed with the rest of the filters.

The other half of the finding this card carried is a limit of Jira rather than of the
provider, and is now stated as such: a Server / Data Center instance pages a search by
position and reports the size of the result, so `pagination.total` reaches the model
along with the offset to continue from, while Atlassian Cloud's `/search/jql` reports
no count at all — there the answer carries `nextCursor` and `isLast`, and the provider
invents no estimate to fill the gap. Raw JQL stays refused for the same reason it was
before: the one vocabulary gap that motivated asking for it is closed by a typed
filter, and the advanced mode the specification describes would need Jira's own parser,
width limits and an audit of the original string.
