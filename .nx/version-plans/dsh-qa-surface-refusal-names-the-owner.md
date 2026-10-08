---
"@yadsh/dsh-qa-surface": patch
---

A chat the stand refuses now says why, and a delegated run stops looking like an outage.

One day of a stand's journal carried twelve ERROR lines of one shape —
`session.agent-resolve-rejected` followed by `lockdown.rejected reason="agent-unavailable"` —
over five sessions, some of them two or three times in a row within minutes. The Host had
answered `session/agent-busy` (`session "<id>" is owned by subagent routing`), which is the
Session domain saying the identity belongs to a delegated run rather than to a chat.
`liveAgent` folded that answer — a correct statement about another conversation's child — into
the same coarse `agent-unavailable` it uses when a restored chat's recorded preset no longer
mounts, so the operator read an outage where nothing needed repairing, and the visitor's console
hint blamed a preset nobody had changed.

The two classes are named apart now. A `session/agent-busy` answer is refused as
`subagent-session` with the one sentence the live-child header check already used, so a delegated
child is refused the same way whether or not its agent happens to be live; the Host answered
correctly, so the journal takes a warning, and `lockdown.rejected` follows it at that level for
the refusals that describe the browser's chat (`composition-mismatch`, `adoption-refused`,
`subagent-session`) while a chat with no agent behind it keeps its ERROR pair — that one is the
deployment's problem. Its message points at the line holding the composition detail, and both
console hints name the cause and the move that follows: re-mount the recorded preset and re-open,
against read the run from its parent chat and start a new one.

The repeat, not the refusal, made the noise. Admission is what lets the Host answer about a chat
at all, so the sources, approvals, questions and workspace Remotes each admit the session before
reading it and one refused chat met the gate once per panel refresh. It was no cycle — every line
belonged to a distinct browser call, and the bridge coalesces while one is in flight — but the
subagent view was asking for the bundles of a session the Host refuses to attest by design, so it
asks for none: a delegated run's sources reach the chat through the inheritance flow, and its
transcript reads them off the projection alone.

The harness stays out of this. `packages/api/session-controller` refuses to resume an identity its
subagent routing owns, reading the durable `origin` mark off the session record — the correct
answer about a child — and what needed repair was the caller flattening it.
