---
"@yadsh/dsh-qa-integrations": minor
---

Add a third integration provider, `teamcity`, as a read-only catalog of 13
tools: server identity and version; project search; build configurations; build
search by project, configuration, branch, status, state and date; one build in
full; its version control changes; its failures — failed tests and build
problems in one answer, because "why did this break" is one question; a bounded
window of its build log; the build queue; investigations; agents; artifact
metadata; and small text artifacts. Nothing in the catalog can change TeamCity
state: trigger, retry, cancel, comment and tags wait for the pending-action
confirmation the specification requires for them, and the parameters endpoints
are never called, so secret build parameters cannot reach the model at all.

Unlike GitLab's operator-declared instances, the TeamCity address is user input
— the server is usually self-hosted — so it is governed by a deployment address
policy instead of a list: `allowlist` mode with `allowedHosts`, `allowedCidrs`
and `allowedPorts`, or `trusted-private` for a company network that trusts its
own DNS. The policy is checked when the connection is stored and again on every
call, so tightening it closes existing connections rather than only new ones;
plain HTTP needs an explicit opt-in, ports are explicit (TeamCity's own 8111
included), redirects are never followed, and the token travels only in the
`Authorization` header. An empty policy is inert rather than fatal — the plugin
logs it at startup instead of failing to load — while a typo in it fails loudly,
because a silently dropped host pattern would leave users with no explanation.

Log text and artifact text are treated as untrusted external content: the log is
downloaded up to a byte budget, stripped of terminal control sequences and
repaired Unicode, redacted, and cut to the requested lines, with `truncated` and
`logTruncated` telling apart "the window was cut" from "the log is longer than
what was downloaded". Artifacts are refused by name before a byte is requested
when they are archives, images, binaries, documents or key material, binary
bodies answer with metadata instead of bytes, and paths with `..`, absolute
paths, backslashes, control characters and archive components (`a.zip!/b`) are
rejected. Lists answer with the same `{ items, pagination }` envelope the other
providers use, and the provider never follows `nextHref`: `pagination.hasMore`
says the page was cut, page sizes stay inside the specification's caps, and a
model that asks for more than the cap gets the cap rather than an error.

The shared engine gained what this provider needed and nothing else: the error
model learned `UpstreamTimeout` (a server that did not answer in time is worth
retrying as it is) and `TlsFailure` (an untrusted certificate is an operator
problem, not a user one), and redaction learned the shapes a CI job actually
prints — `password=…`, `api_key: …`, `--token …` — because log text arrives as a
plain string, where a field-name rule can never see it. Package verification now
asserts the TeamCity catalog is read-only, that no tool schema carries a user,
credential or server selector, and that the address policy is enforced on every
call.

TeamCity cannot report what a token was restricted to, so capabilities are
bounded by the deployment switches and by TeamCity's own permissions, which
surface as `ProviderPermissionDenied` — the provider never tries another
credential. The address policy, rate limiting, caching, webhooks, automatic
multi-page aggregation and the write surface stay out of this release; the
provider's README states each deferred item and what stands in for it today.
