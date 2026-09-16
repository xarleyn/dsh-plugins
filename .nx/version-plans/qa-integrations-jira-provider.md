---
"@yadsh/dsh-qa-integrations": minor
---

Add a fourth integration provider, `jira`. A QA user connects their own
Atlassian account with an API token and gets a read-only catalog of eight tools:
the connected identity and site; issue search over projects, statuses,
assignee/reporter, labels and dates; one issue with its description, relations,
attachment metadata, a comment count and its custom fields; the comments of an
issue with their visibility; attachment metadata; the transitions available to
the connected user; one project; and the site's field catalog.

Sites are operator configuration, never user input: the connect form picks from
the configured list and sends the e-mail and the token alone, so an arbitrary
hostname can never reach the broker. A site address is validated at config load
(HTTPS unless a deployment opts into plain HTTP for a lab, no credentials or
query in the URL, stable id) and is not stored in the credential — it is
re-resolved on every call, so removing or repointing a site closes the
connections made against it instead of silently redirecting a token. The token
travels as HTTP Basic over `email:token` in the `Authorization` header of a GET
that never follows a redirect, and the credential is refused outright when it is
not an Atlassian API token — a pasted URL, a `email:token` pair or a YAML snippet
never leaves the process.

The model gets no JQL. Every tool carries typed filters, and the provider builds
one query from them: values are quoted as JQL string literals with the quote and
the backslash escaped, control characters are refused, project and issue keys are
shape-checked, a name where Jira needs an account id is refused (Jira would
answer an empty page instead), labels are ANDed, and a search without a single
filter is refused rather than turned into "every issue of the site". Search reads
the enhanced endpoint Jira Cloud serves today (`/rest/api/3/search/jql`) with
Jira's own continuation token as the cursor, keeps the page inside the
deployment's ceiling and Jira's own 100 rows, and never walks pages by itself.
Issue bodies arrive as Atlassian Document Format and are rendered to bounded
markdown-like text (headings, lists, code, links, mentions, tables, media
markers) — a JSON tree and an embedded card are never handed to the model, and
nothing a node points at is fetched. Custom fields are named from the site's
field schema, read after the issue answered and never cached, because the same
site answers a different field list to two users with different permissions.

The filter vocabulary is the one a corporate Jira is actually asked about, so a
search can move off a query-string engine without losing questions: project, issue
type, status and its category (`Done` covers every terminal status, whatever the
workflow calls it), priority, resolution, components, labels (all of them, not
any), fix and affected versions including "none set" and "set", assignee and
reporter, created/updated bounds in both directions, and custom fields either by
the id the field catalog reported or by an alias the deployment declared. Dates
take absolute values and Jira's own relative
tokens (`-3w`, `-2d`), a free-text query is either every word or the exact phrase
(with each term its own escaped clause, so an `OR` inside a phrase stays a word),
and the history of one issue is readable through `include: ["changelog_summary"]`
— bounded to twenty field changes and honest about which of the two cuts
happened. A person is accepted as `me`, as an account id, or as a name: the name
is resolved through the site's own user directory, and a name nobody matches or
several people share is refused with what to do next instead of being spent on a
query that quietly answers "no such issues".

`jira.fieldAliases` is where an instance's custom fields get their names: which
of a site's fields carries "the product" is knowledge about that site, so this
package carries no field id at all, the mapping is validated when the config is
resolved (a typo fails the load rather than answering nothing), an unknown name
is refused together with the aliases that do exist, and `jira_get_fields` hands
the model the aliases it may use.

The catalog is an explicit allow-list of Jira Cloud read endpoints, asserted by
the package gate along with the `GET` method of every entry, the absence of the
legacy `/search` endpoint Atlassian removed, and the absence of any JQL argument
in a tool schema. The reads the provider makes beside an operation — the
deployment type at connect and the people directory behind a name filter — are
declared in the same allow-list. A deployment type check refuses a Data Center
instance at connect instead of pretending the Cloud API is compatible.
Capabilities are bounded by the deployment switches alone (`identity.read`,
`issues.read`, `comments.read`, `attachments.read`, `transitions.read`,
`projects.read`, `fields.read`): Jira reports no granted scopes for an API token
and probing with a write is not an option, so the site's own permissions decide
upstream and a refusal stays a refusal.

OAuth 2.0 3LO with rotating refresh tokens, the shared Atlassian
account/resource layer the specification describes, the workspace-to-project
binding, the pending-action confirmation flow every write needs, attachment
content download, a typed filter over the change history (`WAS`/`CHANGED`), the
caching and per-principal rate limiting stay out of this release; the provider's
README states each deferred item and what stands in for it today.
