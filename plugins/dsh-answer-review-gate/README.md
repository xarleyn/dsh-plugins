# @yadsh/dsh-answer-review-gate

Independent answer review gate for DeepSeek Harness agents: before a candidate
final answer is allowed to complete its turn, an independent reviewer checks it
and can send it back for correction. The review is a **lifecycle requirement**
enforced at the turn boundary — not a line in the system prompt.

## What it does

```text
User → primary agent → research / tools / background subagents
     → candidate answer
     → answer-review-gate → reviewer
            ├─ PASS  → the turn may finish
            └─ REVISE → findings are steered back into the primary,
                        which produces a corrected candidate that is
                        reviewed again (bounded rounds)
```

- Interim orchestration turns are **never reviewed**: while the session's own
  background delegations (continuable subagents, one-shot background jobs) are
  still pending, a turn close is treated as a pause, not a final answer. The
  decision is pure runtime state — the plugin records delegated child ids from
  the structured delegation tool result and clears them when the runtime's
  `subagent-settled` notice arrives. No text heuristics ("waiting for…")
  participate in this decision.
- A review PASS applies to the exact candidate content (SHA-256 over the
  normalized text). Any later edit invalidates the PASS and the new candidate
  is reviewed again; the receipt follows the user request, so an unchanged
  candidate is never reviewed twice.
- Review rounds are bounded per user turn (`maxReviewRounds`, default 3). The
  budget belongs to the user request the candidate answers — the agent turns
  and revisions that request takes share one budget, and no agent turn hands
  out a fresh one.
- The reviewer itself is exempt: it runs as a subagent child and subagents are
  never gated, so the reviewer cannot recursively review itself.

## Explicit one-request waiver

When deployment policy permits it, a user can send one request without the
automatic reviewer:

```text
/no-review <request>
```

The command may carry the same image or file attachments as an ordinary
request. It immediately shows a notice that the answer will not be
independently verified, then submits `<request>` as the real user message.
The waiver applies to that request only.

This is a structured command contract, not natural-language detection. The
successful `command/done.sourceEventSeq` must point to the durable
`agent/inbox/spliced` event that admitted the exact user-message id, and the
same lifecycle must start with a human-issued `command/run` for `no-review`.
Phrases such as “review is not needed”, including quoted or negated mentions,
never bypass the gate. A failed command, unrelated message, or old command
lifecycle does not bypass it either.

## Reviewer backends

### `reviewer.backend: domain-expert` (default)

Runs the reviewer domain configured in [dsh-domain-experts](https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-domain-experts)
by **stable domain id** (`reviewer.domain`, default `answer-reviewer`), so the
reviewer persona, policy, tools and model are tuned in the domain-experts UI,
not here. The verdict is derived from the expert's own structured protocol:
findings and conflicts are the review objections; a run with no findings and no
conflicts passes. Phase 1 bound: the domain-experts test entry owns its own
lifecycle, so the reviewer run is not bound to the gate's abort signal (it is a
bounded single run).

### `reviewer.backend: subagent`

Starts a native reviewer child (`reviewer.provider`, default `spawn`) with a
fresh context: it receives only the user request and the candidate answer, an
optional persona (`reviewer.persona`), a read-only tool allow-list
(`reviewer.allowedTools`, empty means no tools) and an optional model route
(`reviewer.route` / `reviewer.model` / `reviewer.reasoningEffort`). The verdict
is requested as structured JSON; unparseable output is a reviewer failure, not
a pass. For correlated-failure reduction, route the reviewer to a different
provider or model than the primary agent.

## Failure policy (`failMode`)

What happens when the review could not complete — reviewer failure, malformed
verdict, or rounds exhausted:

- `open` — allow the answer; audit the failure.
- `warn` (default) — allow the answer, but steer an instruction requiring the
  primary to explicitly qualify that independent verification did not complete.
- `closed` — steer a demand to revise the answer or end with an explicit
  unverified-answer notice; the answer is never presented as verified.

A reviewer failure is **never converted into a PASS**. At most one failure
steer is issued per user turn, so the loop cannot livelock. Note the honest bound:
a plugin cannot hard-block a turn at this seam — `closed` mode forces a
revision-or-disclaim step rather than silently dropping the answer.

## Configuration

```yaml
enabled: true
reviewer:
  backend: domain-expert
  domain: answer-reviewer
  # backend: subagent
  # provider: spawn
  # route: ""
  # model: ""
  # reasoningEffort: ""
  # persona: ""
  # allowedTools: []
maxReviewRounds: 3
failMode: warn
trackBackgroundDelegations: true
minCandidateChars: 80
excludedAgents: []
waiver:
  enabled: true
  allowedInClosedMode: false
audit:
  enabled: true
  maxEntries: 500
```

| Field | Meaning |
| --- | --- |
| `enabled` | Master switch; `false` registers no listeners at all. |
| `reviewer.backend` | `domain-expert` or `subagent`. |
| `reviewer.domain` | Reviewer domain id in dsh-domain-experts (stable id, not a display name). |
| `reviewer.provider` | Subagent provider name for the `subagent` backend. |
| `reviewer.route` / `reviewer.model` / `reviewer.reasoningEffort` | Reviewer route overrides for the `subagent` backend. |
| `reviewer.persona` | Persona instruction for the `subagent` reviewer. |
| `reviewer.allowedTools` | Read-only tool allow-list; empty means the reviewer works without tools. |
| `maxReviewRounds` | Review/revision rounds per user turn before the failure policy applies (1–10). |
| `failMode` | `open` / `warn` / `closed`, see above. |
| `trackBackgroundDelegations` | Suppress review while the session's background work is pending. |
| `minCandidateChars` | Candidates shorter than this skip review. |
| `excludedAgents` | Session-id substrings that are never reviewed (reviewer children are exempt structurally). |
| `waiver.enabled` | Register and honor `/no-review <request>` for exactly one request. |
| `waiver.allowedInClosedMode` | Permit the command while `failMode: closed`; default `false`. |
| `audit.enabled` / `audit.maxEntries` | In-memory audit ring of decisions (metadata only — never prompt or response text). |

## Requirements

- DeepSeek Harness >=0.1.5-rc.2 <0.2.0
- Node.js ^22.19.0 or >=24.0.0

## Installation

```bash
dsh plugin --profile <profile> add @yadsh/dsh-answer-review-gate
```

The `--profile` flag is required.

## Compatibility

- DeepSeek Harness >=0.1.5-rc.2 <0.2.0 (see `compatibility.json`).
- Uses the `commands` host service plus the `agent/turn-stopping`,
  `tools/result` and `agent/inbox/inserted` lifecycle seams — no DSH core
  changes.

## Security model

- The reviewer runs in a fresh context and receives only the review material
  (user request, candidate answer). It does not inherit the primary agent's
  hidden reasoning.
- The `domain-expert` backend's tool access is whatever the configured domain
  grants; configure the reviewer domain read-only. The `subagent` backend's
  tools are exactly `reviewer.allowedTools` — keep it read-only.
- Reviewer output is untrusted model output: it is parsed and validated, a
  malformed verdict is a reviewer failure handled by the failure policy, and
  the primary remains responsible for checking reviewer evidence rather than
  blindly obeying it.
- Audit records contain decision metadata only (session, turn, candidate
  hash, rounds, durations, verdict or structured waiver reason) — no prompt or
  response text. `/no-review` also sets `recordInput: false`, so its lifecycle
  record does not duplicate the request text; the normal user message remains
  the sole authoritative copy.

## Scope of Phase 1

Shipped: turn-stopping gate, both reviewer backends, candidate hashing,
REVISE-via-steer, round limit, recursion protection, background-delegation
suppression, structured one-request waiver, in-memory audit, tests. Deferred to later phases: durable
/replayable review state, evidence bundle, full metrics export, and a UI badge.

See [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-answer-review-gate/SPEC.md)
for the product contract.

## Development

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## License

MIT
