## 0.3.0 (2026-09-22)

### 🚀 Features

- Memory is kept per QA account, and each account can switch automatic context ([d0873e9](https://github.com/xarleyn/dsh-plugins/commit/d0873e9))
  off for itself.

  One plugin serves every chat on a deployment, so until now every account read
  from and wrote into the same OpenViking space: recall handed one user another
  user's memories, and capture filed one user's conversation where the next user's
  recall would find it. With a QA surface mounted the plugin now asks it who owns
  the session (`principalForSession`) and sends that account as
  `X-OpenViking-User`; a delegated child inherits the chat that created it, and a
  session no account has claimed yet is left entirely alone — it issues no request
  at all until its browser half claims it. Deployments without a QA surface keep
  the single deployment-wide identity, and `qaUserScoping: false` restores it
  explicitly.

  The settings card now actually appears. It never did, anywhere: a card is
  rendered only for a namespace the live plugin registered in the Host's settings
  directory, and this plugin only declared its schema — `static Config` publishes
  nothing. The host half now installs its section (the same shape the first-party
  cards use), which makes the namespace discoverable in a local installation, and
  adopts the section as its configuration source: a committed change is
  re-resolved and handed to the running runtime, so a switch reaches sessions that
  are already open, while the bridged MCP tools follow on the next reload.

  The switches a user owns moved to where that user can reach them. The Host's
  "Plugin configuration" card is discovered from the settings directory, which a
  browser reaching a deployment over the network never gets — and a QA overlay
  does not render the native settings tree at all — so on a QA deployment the card
  was unreachable for everybody even once it registered. The plugin now also registers a page in the
  signed-in user's QA settings dialog ("Память"), backed by three Remote methods
  that authenticate the caller by token and store the answer per account in
  `openviking-memory-qa-users.json` under `$DSH_HOME`. The page narrows the
  deployment's plan and can never widen it: `autoInject` off silences the profile
  and the recall for that account, capture and the memory tools keep working, and
  one reset hands every knob back to the deployment.


### 🩹 Fixes

- Memory stops presenting itself as the first source, and stops repeating itself. ([fa564fb](https://github.com/xarleyn/dsh-plugins/commit/fa564fb))

  The skill's trigger claimed the tools for any task that lacked context — "or when
  the task needs context this session does not have, even if nobody says the word
  memory" — which is every task that has not read its file yet. A model that could
  not read an attached document therefore had a description telling it that memory
  was the tool for the gap, and answered with a series of `find` → `search` →
  `read` → `glob` calls against the store while the document sat in the session.

  The description now owns memory-specific questions only (earlier sessions, "like
  last time", remembering and forgetting, where memories are filed), and the skill
  carries the order of sources it was missing: the conversation and this workspace
  first — attachments and documents are read with the file and document tools —
  then the product documentation and the domain expert, and only then memory. Two
  habits follow, matched to the failure: a miss in memory is not an answer, so a
  chain of searches is not a way to find a document; and one memory round per
  question is enough, because a reworded repeat returns what the first round did.

  The injected block says the same thing in its own words. `RECALL_FRAMING` in the
  runtime is the copy that travels with every recall envelope, whether or not the
  skill was activated, and the session now delivers a block once: an identical
  assembled block the conversation still carries is not injected again on the next
  step. The retrieval itself is unchanged — the plugin still asks the server per
  step, and the model can still search memory freely; what changed is that nothing
  in the plugin recommends memory as the default place to look.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

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