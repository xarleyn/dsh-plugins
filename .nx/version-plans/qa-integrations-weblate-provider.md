---
"@yadsh/dsh-qa-integrations": minor
---

Add a sixth provider to the integrations plugin: Weblate, the localization
platform, read as the connected QA user. It ships nineteen read-only tools —
the connection itself, projects, components, languages of a component, string
search, a single string with every plural form and its state, the comments and
suggestions left on it, checks that fail, statistics and change history — and
the catalog carries no operation that could change Weblate state, so
suggestions, comments, edits, approvals, translation files and the repository
stay out until the confirmation framework exists.

A connection is one of the operator's configured instances plus a Weblate API
token, kept in one encrypted credential; the connect form picks the instance
and never types a host, and the address is re-resolved from deployment config
on every call, so an instance the operator removes fails closed instead of
moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
as a label — personal or project-scoped — and are never treated as a permission
check.

Weblate's search grammar is composed by the provider from validated filters
rather than accepted from the model: values are quoted and escaped, states come
from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
from the page number of the upstream `next` link, only when that link points at
the configured instance. Every answer that carries upstream-authored text — a
source string, a translation, a comment, a change — is marked as untrusted
external content, and localization strings handed to the model are bounded and
say when they were cut.
