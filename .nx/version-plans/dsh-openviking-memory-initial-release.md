---
"@yadsh/dsh-openviking-memory": minor
---

Initial @yadsh distribution derived from OpenViking's Apache-2.0 licensed
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
