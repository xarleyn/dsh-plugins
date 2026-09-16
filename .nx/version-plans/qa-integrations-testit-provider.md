---
"@yadsh/dsh-qa-integrations": minor
---

Add a sixth provider to the integrations plugin: Test IT, read as the connected
QA user through their own API token. It ships twenty-two read-only tools — the
projects and sections of the test library, test cases, checklists and shared
steps with their steps, attributes and tags, the change log and comments of a
case, test plans with their per-plan summary, runs with the test points and
results inside them, single results with their messages and traces, attachment
metadata, a bounded text read of a small attachment, autotests and the
configurations a result is recorded against.

A Test IT installation is operator configuration: `testit.instances` lists the
Cloud tenants and on-premise TMS servers this deployment allows, the connect form
only picks from that list, and the address is re-resolved from config on every
call, so removing or repointing an instance closes existing connections too. The
token travels as the `PrivateToken` authorization header and nowhere else.

The catalog holds GET endpoints only, which is what this package's read-only
guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
so the provider reaches the same ground through the GET surface — a run's test
points instead of its statistics, a plan's summary instead of a filtered
aggregate — and the tools it cannot back that way are listed as missing in the
README rather than smuggled in. Three of the reads it does use are the endpoints
Test IT marks deprecated; they are the only GET reads of those collections, and a
version that drops them answers an honest "not available here".

Test IT text is untrusted content: descriptions, steps, comments, messages and
traces reach the model as bounded blocks under `untrustedContent`, and an
attachment is described by Test IT itself before a byte is requested, so archives,
images and oversized files are refused by the server's own account of the file.
