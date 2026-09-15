---
"@yadsh/dsh-qa-integrations": minor
---

Add a second integration provider, `gitlab`, and turn the settings section into
one card per mounted provider. The provider connects a QA user to their own
GitLab identity with a personal access token and exposes a read-only catalog of
23 tools: connection identity; project search and project cards; repository tree,
file reads with metadata, commit lists, single commits and ref comparison;
cross-GitLab search over projects, issues, merge requests, commits, code and
comments; issues with their notes; merge requests with changed files,
discussions, approvals and attached pipelines; and pipelines with their jobs and
logs.

Instances are operator configuration, never a user input: the connect form picks
from the configured list, so an arbitrary hostname can never reach the broker.
The instance address is validated at config load (HTTPS unless a deployment
opts into plain HTTP for a lab, no credentials or query in the URL, stable id)
and is not stored in the credential — it is re-resolved on every call, so
removing or repointing an instance closes access to tokens minted for it instead
of silently redirecting them. Requests are GET-only, never follow redirects, and
carry the token in the `PRIVATE-TOKEN` header alone.

Capabilities follow the scopes the token really reports: on connect and on every
connection test the provider asks GitLab what the token holds
(`/personal_access_tokens/self`) and offers `identity.read`, `projects.read`,
`repository.read`, `search.read`, `issues.read`, `merge_requests.read` and
`ci.read` only where the deployment switch and the token agree. A token that
cannot read itself costs precision, not safety, because the deployment switches
still bound the surface. Repository files and CI logs are size-bounded before
they reach the model, binaries and oversized bodies answer with metadata and a
truncation marker instead of raw bytes, diff text spends a shared character
budget, and job logs pass through secret redaction — GitLab's own masking is a
filter, not a promise.

The write surface, OAuth with PKCE, the user-selectable project boundary, the
pending-action confirmation flow, caching and webhooks stay out of this release;
the provider's README states each deferred item and what stands in for it today.

The shared engine stays provider-agnostic: `parseCredential` gained an optional
non-secret options map so a connect form can name the instance a token belongs
to, the error model gained `ResourceNotFound`, `RateLimited` and
`ResultTooLarge`, and redaction learned the `glpat-` token shape. Package
verification now asserts the GitLab catalog is read-only, that no tool schema
carries a user, credential or instance selector, and that neither provider's
name leaks into the shared modules.
