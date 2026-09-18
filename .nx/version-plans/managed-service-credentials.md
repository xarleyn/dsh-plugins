---
"@yadsh/dsh-qa-integrations": minor
---

Managed service credentials for GitLab and TeamCity.

A deployment can now publish one read-only credential it owns, so a user who
cannot mint a personal access token — or does not want to — can still work
through the integration layer. A profile is deployment configuration: the
provider instance it belongs to, the label users see, the mounted secret, and
the resources it may read. A new connection starts on that credential when the
deployment says so; an existing connection keeps the credential it already had,
because an upgrade must never move somebody onto a shared account.

The shared credential is not simply read-only. Every operation carries security
metadata — effect, sensitivity, and whether the managed credential may reach it —
and service mode runs only what is a read, of normal sensitivity, explicitly
classified as safe. Writes, admin actions, permission and credential management
stay unreachable even when the service token upstream allows them, and sensitive
reads stay personal-only: GitLab CI job logs, TeamCity build logs and text
artifacts. A confidential GitLab issue is never returned through the shared
account — not by id, not in a listing, and not in a search — and a search of
notes, where the parent's confidentiality cannot be checked at all, stays
personal. An operation the provider does not classify is denied, so a tool added
by a later provider update is not reachable through the shared credential until
someone classifies it on purpose. An administrator can narrow the ceiling, never
widen it.

Because the shared account sees far more than one user should, every profile
carries a resource allowlist that is a hard upper bound. A service-mode call
resolves the project it names against that list, a build addressed by its id is
first resolved to its owning project, and a listing that names no resource is
refused rather than answered with the whole instance view. Expanding a GitLab
group asks for the group's own projects and checks every one that comes back, so
a project shared into it from elsewhere stays out. A user may narrow the list
further from the card; a selection outside it is dropped rather than stored.

There is no fallback in either direction: a `403` in personal mode is a denial
and is not retried with the service account, and the reverse holds too. A stored
personal credential stays inactive while a connection runs on the service
credential, and either side can be chosen later — switching bumps the binding
revision that everything derived from the previous identity is keyed by. The
secret is read from its file on each call and identified by a content hash, so
rotating a mounted secret takes effect on the next call without anyone
reconnecting. Upstream only ever sees the service account, so every audit row
records the authenticated QA user, the operation, the credential source and the
service profile.

GitLab's single `ci.read` capability split in two: `ci.metadata.read` for
pipelines, jobs and statuses, and `ci.logs.read` for what a job printed, which
is personal-only. The deployment switches follow (`ciMetadataRead`,
`ciLogsRead`); the pre-split `ciRead` still works and governs both halves, and a
connection that stored the old capability id is repaired at startup with the
policy it had set.

Bitrix24, Jira, Confluence, Test IT and Weblate are unchanged: they offer no
service mode, and their cards show nothing about it.
