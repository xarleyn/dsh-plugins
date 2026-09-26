---
"@yadsh/dsh-audit-core": patch
"@yadsh/dsh-audit-ui": patch
"@yadsh/dsh-plugin-kit": patch
"@yadsh/dsh-plugin-log": patch
---

Every publishable library under packages/ now carries a gate of its own.

Each of the four gained a `verify` target that holds the promises packing cannot
check: `main` and `types` name the same file as the root export, every declared
subpath is built, and every published dependency range resolves for a consumer
that installs from the registry — a `workspace:` range never names a private or
missing member, a `catalog:` range never names a member at all, and a member is
never declared as a plain range. The package hygiene gate requires the target to
stay and reads the call itself, so a library that loses its gate — or keeps the
script while dropping one of the two checks — fails locally and in CI instead of
shipping unchecked.
