---
"@yadsh/dsh-qa-integrations": patch
---

Stop retrying GitLab calls the deployment itself timed out, and name a TLS refusal as such.

The GitLab transport folded every failed fetch — including the abort of its own
per-request deadline — into a single `ProviderUnavailable` error and spent a
retry on it. A slow GitLab therefore waited for `timeout × (retries + 1)`
before the user saw anything, and an untrusted certificate surfaced under the
same "provider is unavailable" reason as a network outage, sending the operator
to check reachability instead of the trust store.

The transport now shares the TeamCity transport's failure classification: an
aborted deadline is reported as `UpstreamTimeout` and is never re-sent, a
failed TLS handshake is reported as `TlsFailure`, and only genuinely transient
network faults are retried. The GitLab settings card carries the same
human-readable explanations for the two new reasons that the TeamCity card
already showed. The TeamCity provider's behavior is unchanged.
