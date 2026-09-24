---
"@yadsh/dsh-qa-integrations": minor
---

Service-mode calls now stop at a ceiling the operator sets, before they reach the vendor.

A managed credential is one upstream identity shared by every account that points
at it, so the old failure shape was collective: one chatty principal spent the
quota the whole deployment runs on, and the vendor saw only the credential, not
who asked. The service mode gained two token buckets —
`managedServiceCredentials.rateLimit.perPrincipal.requestsPerMinute`, what one
account may ask of one provider through any managed credential, and
`perCredential`, which carries both `requestsPerMinute` and `maxConcurrent` for
the shared upstream identity itself. Buckets refill continuously at their own
rate rather than on a wall-clock minute, so a burst may take a full minute of
requests and is then held to the steady rate; a dimension set to `0` is unbounded.

The ceiling is two-sided on purpose, and both sides are read before either is
written: a call the shared bucket refuses leaves the user's own balance untouched,
and a call the user's bucket refuses leaves the shared balance untouched. Without
that order a noisy account would pay for the bottleneck it creates with everybody
else's allowance. A refusal answers `RateLimited` with a retry-later notice, is
audited against the real principal — the limit is decided here, so upstream never
learns the request existed — and costs nothing to the vendor.

Nothing is configured, because an unconfigured deployment is the case that needs
the limit most: the shipped default is the request ceiling the design document
already named, 120 requests a minute per principal and 1000 a minute with 16
calls in flight per credential. A deployment that wants a looser or a harder
ceiling sets `rateLimit`; one that wants a dimension unbounded sets it to `0`.
Personal-mode calls stay unthrottled — there the user's own credential already
carries the frequency, and the vendor sets that limit itself.
