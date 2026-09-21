---
"@yadsh/dsh-session-scope": patch
---

The browser client is built by tsdown, like every other plugin's client half.

`src/client.ts` used to be a prebuilt bundle living in the source tree: a single
`@ts-nocheck` script that hand-wrote `window.__ModuleLoader__.load(...)`,
required `react` and `react-dom` through the factory's own `require`, and was
copied to `lib/client.js` by `tsc` unchanged. It is now an ordinary ES module
that exports the Cordis client plugin, and `tsdown` wraps it into the shell's
classic factory — the same banner, intro and footer every other client uses.

Nothing the shell sees changes: the bundle still registers exactly
`@yadsh/dsh-session-scope` through `window.__ModuleLoader__`, still takes
`react` and `react-dom` as shell statics instead of shipping its own copy, still
contributes the Scope chip to the composer's left seat, and still reads the
directory tree through the dedicated non-durable `sessionScope/list` RPC rather
than through a `/scope` command. Because the artifact is now generated rather
than authored, the manifest declares `./client` as its bundle path: a
module-loader bundle is fetched and registered by the shell, so it has no
importable type surface to point `types` at.
