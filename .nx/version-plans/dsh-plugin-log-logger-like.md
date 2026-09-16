---
"@yadsh/dsh-plugin-log": minor
---

Export the shared structural logging contract `PluginLoggerLike` and the
`silentPluginLogger()` stub from the package instead of per-plugin copies.

Server plugins keep their services and tool factories on a narrow
`debug`/`info`/`warn`/`error` surface so tests can inject a stub while the
entrypoint binds the real logger; until now every plugin declared that
contract (and its silent stand-in) in its own `src/logging.ts`. The contract
now lives next to `PluginLogger`, which satisfies it structurally, so
`dsh-cas-results`, `dsh-git-readonly` and `dsh-tool-offload` re-export the
identical surface from this package.
