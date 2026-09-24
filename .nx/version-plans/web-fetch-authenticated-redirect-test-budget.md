---
"@yadsh/dsh-web-fetch-authenticated": patch
---

The plugin's redirect suite stops losing to its own timeout on a loaded Windows
run.

Vitest gives a test five seconds and this package re-exported the shared preset
with no override. The suite drives a local HTTP fixture and costs 55ms on an
idle machine, but a full `nx run-many -t test` runs eight projects at once, and
one redirect test was then observed hitting the five-second cap on a loopback
round-trip it normally finishes in milliseconds. The package now budgets 30
seconds per test, the allowance the browser plugin already gives its I/O-bound
suites.

No runtime behavior changed: the fix is test configuration.
