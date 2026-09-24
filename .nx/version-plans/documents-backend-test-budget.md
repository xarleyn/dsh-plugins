---
"@yadsh/dsh-documents": patch
---

The plugin's backend suite stops losing to Vitest's default timeout on a loaded
Windows run.

Rendering goes through a configured executable, so each render costs a real
child process and its cold start. Vitest gives a test five seconds and this
package re-exported the shared preset with no override; a full
`nx run-many -t test` runs eight projects at once, and the test that renders
twice through a failing backend was observed hitting that cap at 5036ms while
its neighbours cost up to four seconds. The cap, not the renderer, is what
failed it. The package now budgets 30 seconds per test, the allowance the
browser plugin already gives its I/O-bound suites.

No runtime behavior changed: the fix is test configuration.
