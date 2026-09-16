---
"@yadsh/dsh-qa-integrations": minor
---

Add a fourth provider to the integrations plugin: Confluence Cloud, read as the
connected QA user. It ships eight read-only tools — the connected account and
site, typed CQL search, a page with its body rendered from Atlassian Document
Format, page comments with replies, attachment metadata, page versions and
spaces — and the catalog carries no operation that could change Confluence
state.

A connection is an operator-configured site plus an Atlassian API token and the
account e-mail, kept together in one encrypted credential, and a model tool can
never name a site, an account or a credential. The site address is re-resolved
from deployment config on every call, the space allowlist
(`confluence.allowedSpaces`) is enforced on search and on direct reads alike,
and every page or comment body reaches the model as untrusted content under its
own key.
