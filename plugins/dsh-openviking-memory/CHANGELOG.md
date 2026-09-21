## 0.2.0 (2026-09-21)

### 🚀 Features

- The plugin gets a settings card, so its configuration is editable from ([80e928f](https://github.com/xarleyn/dsh-plugins/commit/80e928f))
  **Settings → Plugins** in the DSH web UI instead of a patch file.

  The card edits the plugin's `dsh-openviking-memory` settings namespace
  directly. Sections follow the configuration contract: the four automatic
  context presentation knobs with the master-switch semantics spelled out, the
  connection fields, peer identity, the recall knobs, capture and commit, and an
  advanced group for `skipSubagentSessions`, the two timeouts and the deprecated
  `captureMode`.

  Writes are immediate scalar sets, and clearing a field drops the user-layer
  override so the value re-inherits the composition layer — which for the
  connection fields means the `OPENVIKING_*` environment variables and credential
  files stay in charge. Fields marked as overridden by the profile's user layer
  carry an override marker, and one reset action clears all of them. The four
  knobs the schema deliberately leaves without a default render their upstream
  fallback as a placeholder and write only when a value is named, so the
  "configured" and "defaulted" cases stay distinguishable.

  The card is configuration-only: the header badge projects the master switch
  (`Auto-inject` / `Manual recall`), not live runtime state — diagnostics remain
  in the plugin log.


### 🩹 Fixes

- Reject an empty `grep` pattern or `search`/`find` query as invalid parameters instead of forwarding it to the OpenViking server. ([9c78405](https://github.com/xarleyn/dsh-plugins/commit/9c78405))

  The upstream server answers a retrieval call whose free-text parameter carries no non-whitespace character with a plain "no matches" result. That reads as a real, negative answer, so a model that sent an empty argument once kept resending it — one audited QA-stand session logged seventeen byte-identical empty `grep` calls in a row, each answered the same way. The stdio proxy now answers such calls itself with a JSON-RPC invalid-params error naming the parameter, and rewrites the upstream `tools/list` schemas so `grep.pattern`, `search.query` and `find.query` are advertised as required with a minimum length — the contract is visible before the model's first call, and `grep`'s list form of `pattern` gets `minItems` instead. `grep` keeps accepting either a single pattern or a list; only the all-empty shapes are refused.

  Both checks ride on two new proxy-core seams (`requestGuard`, `adjustUpstreamTool`) supplied by the harness entrypoint, so the vendored core stays free of OpenViking tool knowledge; see UPSTREAM.md.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-18)

### 🩹 Fixes

- Reject an empty `grep` pattern or `search`/`find` query as invalid parameters instead of forwarding it to the OpenViking server. ([942d68d](https://github.com/xarleyn/dsh-plugins/commit/942d68d))

  The upstream server answers a retrieval call whose free-text parameter carries no non-whitespace character with a plain "no matches" result. That reads as a real, negative answer, so a model that sent an empty argument once kept resending it — one audited QA-stand session logged seventeen byte-identical empty `grep` calls in a row, each answered the same way. The stdio proxy now answers such calls itself with a JSON-RPC invalid-params error naming the parameter, and rewrites the upstream `tools/list` schemas so `grep.pattern`, `search.query` and `find.query` are advertised as required with a minimum length — the contract is visible before the model's first call, and `grep`'s list form of `pattern` gets `minItems` instead. `grep` keeps accepting either a single pattern or a list; only the all-empty shapes are refused.

  Both checks ride on two new proxy-core seams (`requestGuard`, `adjustUpstreamTool`) supplied by the harness entrypoint, so the vendored core stays free of OpenViking tool knowledge; see UPSTREAM.md.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-15)

### 🚀 Features

- Initial @yadsh distribution derived from OpenViking's Apache-2.0 licensed ([1c0a9cb](https://github.com/xarleyn/dsh-plugins/commit/1c0a9cb))
  `@openviking/dsh-memory-plugin`, adding controllable automatic profile/recall
  injection.

  The plugin connects one DSH profile to an OpenViking server and keeps five
  capabilities independent: the `mcp__openviking__*` MCP tools, the
  `openviking-memory` skill, conversation capture and commit, the `viking://` URI
  guard, and automatic context presentation. Only that last capability is governed
  by the new `autoInject` switch and its three granular knobs
  (`injectStartupProfile`, `injectStepProfile`, `autoRecall`).

  Setting `autoInject: false` disables every automatic profile and recall
  injection *and* the requests behind them — no profile read and no recall search
  is issued, rather than a request whose result is discarded. Tools, skills,
  capture, commit and the URI guard keep working, so an agent can still learn from
  the conversation and still call OpenViking itself when it decides memory is
  worth the latency. The default configuration reproduces upstream semantics.

  The package also modernizes the port to this monorepo: TypeScript under `src/`,
  a typed Schemastery schema that rejects out-of-range values instead of silently
  clamping them, structured logs under `<$DSH_HOME>/logs/dsh-openviking-memory/`,
  and the standard build/release tooling. Upstream provenance, the dropped
  cross-harness helpers and the upstream-sync process are recorded in `UPSTREAM.md`
  and `docs/upstream-sync.md`.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn