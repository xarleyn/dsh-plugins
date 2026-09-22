---
"@yadsh/dsh-ui-repair": patch
---

The client bundle has one named build step instead of a side effect of `test`.

Bundling `lib/client.js` lived inside the `test` script as an anonymous `tsdown`
invocation, so the artifact the verification gate reads was whichever command
ran last: a suite could pass against a bundle no build had produced, and `build`
— which deletes `lib/` before it writes — could take that same file away while
a suite was loading it.

The step is now the named `build:client` goal. `build` reuses it after the
clean, `test` consumes the goal instead of invoking the bundler on its own, and
a wiring test fails if either script grows the step back.
