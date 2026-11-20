# @yadsh/dsh-answer-review-gate

An operator can configure `workbookReview` with a trusted local `provider` and `model`, the protected workflow's `workflowTool`, and its `skill` name. Workbook attachments, workbook filenames in requests, and calls to spreadsheet tools select this route for subsequent reviews in the same history. The reviewer receives bounded producer receipts and can read exact document extractions prepared by the gate. It has no delegation, filesystem browsing or network tool. If this route fails, the gate applies its configured failure policy. Configure the primary agent's compaction provider and model separately.

Independent answer review gate for DeepSeek Harness agents: before a candidate
final answer is allowed to complete its turn, an independent reviewer checks it
and can send it back for correction. The review is a **lifecycle requirement**
enforced at the turn boundary — not a line in the system prompt.

Document reviewers must return comparison witnesses in native structured
`comparisons` fields: exact evidence keys, verbatim source and deliverable
passages, and an explanation. Each required pair is checked against the
original fingerprints and that reviewer's successful read windows. Summary
formatting cannot replace these checks. Domain Experts 0.6.1 and later carries
this field through native capture; older backends retain the witnessed CHECK
summary format. An unread file, invented quotation or missing pair still fails
closed.

Native review capture requires a `comparisons` array (`[]` when no document
pairs were requested). Each quotation is one contiguous passage copied from
the read file, including Markdown table pipes. A missing or altered witness is
returned to the reviewer against the unchanged candidate, without asking its
author to repair reviewer evidence. Every corrective activation consumes the
existing `maxReviewRounds` budget, shares the original deadline and fingerprints,
and must perform its own reads. Exhaustion still fails closed.

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
  passed candidate is never reviewed twice. Reviewer protocol correction may
  recheck a candidate that has not yet passed.
- Review rounds are bounded per user turn (`maxReviewRounds`, default 3). The
  budget belongs to the user request the candidate answers — the agent turns
  and revisions that request takes share one budget, and no agent turn hands
  out a fresh one.
- The loop is meant to converge: the reviewer of round N receives the findings
  of the previous rounds in a delimited `<review_history>` block and verifies
  their resolution first — a settled finding is not restated, a still-standing
  one is re-raised with current evidence, and new objections are admitted only
  when they are material. Without that context every round re-reviews the
  candidate from scratch and the issue count grows between rounds instead of
  collapsing.
- Each review round runs against a wall-clock deadline
  (`reviewer.roundTimeoutMs`, default 10 minutes, `0` disables). An expired
  deadline aborts what the backend can cancel (a subagent child; a domain
  expert run is owned by its service and its late result is dropped), ends the
  round as a reviewer failure under the configured failure policy — the honest
  unverified qualification, never a PASS — and releases the turn instead of
  holding it open while a stuck reviewer never answers. The deadline adds no
  retries of its own; transport retries stay with the provider's configured
  retry policy.
- A revision steer admits exactly one visible artifact: the corrected answer.
  Findings are handed back as a delimited `<review_notes>` block, and the steer
  asks for no account of the review — a demand to "state the disproof" of a
  rejected objection was resolved literally on a live stand, and the user read
  the primary's argument with its reviewer. A draft that opens by disputing the
  review (`Опровержение вывода ревизора: …`) is that leak: in a turn that has
  already been reviewed the gate demands the answer's shape once, and that draft
  is not handed to a reviewer, so it cannot be certified as verified. The honest
  bounds: a committed message cannot be edited at this seam, so a second such
  draft goes through the ordinary review path, and a request the user waived is
  settled before the guard runs.
- Independent reviewers can delegate through the tools their preset exposes,
  including configured aliases. Each call waits for its child and returns the
  child's result to the reviewer before it submits `structured_output`. Local
  descendants follow the same rule, within the Host's depth and capacity limits.
  The native reviewer backend requires a local managed provider to install this
  behavior before the first prompt. The Agent Preset and deployment permissions
  determine which tools the reviewer can use.
- The reviewer itself is exempt: it runs as a subagent child and subagents are
  never gated, so the reviewer cannot recursively review itself.

With a QA surface that supports review scoping, an automatic review also keeps
its permitted verification tools when the primary request uses RAG Priority.
The Host marks the reviewer only during that exact review call; this does not
grant deep-search consent to the primary agent or to ordinary delegated agents.
The reviewer's own tool policy and the deployment's permissions still apply.

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

Both backends receive the latest human request's original durable image blocks,
including requests with no text. The Host applies the reviewer's selected model
capabilities and image limits; the gate does not replace images with text-only
placeholders. A reviewer that cannot inspect an attachment reports its own
verification gap without inferring that the primary agent could not see it.
Image and text reviews use the same cancellable domain-experts entry. Image
references are passed through on each attempt, including capture recovery.

### `reviewer.backend: domain-expert` (default)

Runs the reviewer domain configured in [dsh-domain-experts](https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-domain-experts)
by **stable domain id** (`reviewer.domain`, default `answer-reviewer`), so the
reviewer persona, policy, tools and model are tuned in the domain-experts UI,
not here. The verdict is derived from the expert's own structured protocol:
Findings, conflicts, unsupported assumptions and blocking follow-ups all require
revision. A run passes when all four lists are empty. Every review passes the round's cancellation signal to the
host-only `reviewExpertBounded` entry. A service without that capability reports
`review-budget-unavailable` through `failMode` before a reviewer starts.

For a bounded review, set `maxToolCallsPerRound` (for example `60`),
`maxConsecutiveRefusalsPerRound` (`5`) and `reviewTimeoutMs` (`120000`). All
default to `0`, which disables the respective numeric limit. Parent cancellation
and the outer round deadline still reach the reviewer. Nonzero numeric limits
require the `domain-expert` backend. The monitor counts completed calls from this reviewer and its delegated descendants,
resets the error streak on success and exempts native structured result capture.
At a limit, timeout or caller cancellation it disposes the managed activation
before reporting a failed review. A bounded round makes one attempt; missing
structured output follows the failure policy without resetting the budget.

Saved long review packets carry an absolute path so a child with another working
directory can open the same file. Workspace containment and content verification
still apply.

### `reviewer.backend: subagent`

Starts a native reviewer child (`reviewer.provider`, default `spawn`) with a
fresh context: it receives only the user request and the candidate answer, an
optional persona (`reviewer.persona`) and an optional model route
(`reviewer.route` / `reviewer.model` / `reviewer.reasoningEffort`). The verdict
must be delivered by the native `structured_output` tool; prose and fenced
JSON are not captured verdicts. For correlated-failure reduction, route the
reviewer to a different provider or model than the primary agent.

The Host composes the child's tools using the selected Agent Preset
(`reviewer.agentPreset`) or its provider's default composition. Inspect the
tools contributed by that preset and by its plugins, including those available
to delegated workers.

To limit both reviewer backends and their workers, set
`reviewer.enforceAllowedTools: true` and list the trusted tools in
`reviewer.allowedTools`. For example, `[read, grep, qa_subagent]` permits
reads, searches and delegation through that tool wherever the Host grants them.
Verify deployment-owned aliases before adding them. The gate always permits
native `structured_output`. A worker whose provider cannot install the policy
is refused before launch. Some tools contributed directly by a preset or a
plugin can still appear in the model's catalog. The scoped execution guard
rejects unlisted names, including tools registered later.

## Capture recovery and current review status

If a reviewer ends without native structured output and without a diagnostic,
the gate makes one fresh, isolated attempt on the same immutable candidate.
The retry explicitly requests `structured_output`. Real provider errors,
refusals and cancellation are not retried. Two missing captures follow the
configured failure policy; reviewer prose is never promoted to PASS.

The gate records a standard producer notice containing the answer sequence,
content hash, human-request sequence and current status. QA Surface renders a
compact current-status badge in QA and native chat. A later result replaces the
badge for that request, and applies only to its recorded answer version. Replay
preserves the status; earlier model-authored messages remain history. Waived,
failed and cancelled reviews are visibly different from a verified answer.

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
  # agentPreset: reviewer-readonly  # id of a preset installed by the operator
  # enforceAllowedTools: true
  # allowedTools: [read, grep, qa_subagent]
  # roundTimeoutMs: 600000    # per-round wall-clock budget; 0 disables
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

### Operator controls

Open **Plugins → Answer Review Gate → its configuration row** in the Host interface.
The card edits the profile through the Host settings service. It exposes the tool
budget, review timeout, consecutive-error limit, revision rounds, outer deadline
and failure policy. Deadlines are displayed in seconds and stored in milliseconds.
Committed values apply to subsequent review operations; a running round retains
the budget with which it started. Read-only or unavailable profiles cannot save changes.

The review timeout includes delegated experts. The outer deadline bounds the whole
backend call, so whichever deadline expires first ends that round. Zero disables
an individual deadline or tool limit; a failed review is never converted into a PASS.

| Field | Meaning |
| --- | --- |
| `enabled` | Master switch; `false` registers no listeners at all. |
| `reviewer.backend` | `domain-expert` or `subagent`. |
| `reviewer.domain` | Reviewer domain id in dsh-domain-experts (stable id, not a display name). |
| `reviewer.provider` | Subagent provider name for the `subagent` backend. |
| `reviewer.route` / `reviewer.model` / `reviewer.reasoningEffort` | Reviewer route overrides for the `subagent` backend. |
| `reviewer.persona` | Persona instruction for the `subagent` reviewer. |
| `reviewer.agentPreset` | Agent Preset id for the native reviewer. The selected provider must support preset selection. |
| `reviewer.allowedTools` | Trusted tool names. With enforcement enabled, an empty list permits only native result capture. |
| `reviewer.enforceAllowedTools` | Apply the list throughout the local review tree. Defaults to `false`, which preserves preset behavior and the native backend's `TOOL_UNFILTERABLE` diagnostic. |
| `reviewer.roundTimeoutMs` | Wall-clock budget for one review round (10000–1800000, default 600000; `0` disables). An expired deadline ends the round under the failure policy instead of holding the turn open. |
| `maxReviewRounds` | Review/revision rounds per user turn before the failure policy applies (1–10). |
| `failMode` | `open` / `warn` / `closed`, see above. |
| `trackBackgroundDelegations` | Suppress review while the session's background work is pending. |
| `minCandidateChars` | Candidates shorter than this skip review. |
| `excludedAgents` | Session-id substrings that are never reviewed (reviewer children are exempt structurally). |
| `waiver.enabled` | Register and honor `/no-review <request>` for exactly one request. |
| `waiver.allowedInClosedMode` | Permit the command while `failMode: closed`; default `false`. |
| `audit.enabled` / `audit.maxEntries` | In-memory audit ring of decisions (metadata only — never prompt or response text). |

## Requirements

- DeepSeek Harness >=0.2.2-rc.3 <0.3.0-0
- Node.js ^22.19.0 or >=24.0.0

## Installation

```bash
dsh plugin --profile <profile> add @yadsh/dsh-answer-review-gate
```

The `--profile` flag is required.

## Compatibility

- DeepSeek Harness >=0.2.2-rc.3 <0.3.0-0 (see `compatibility.json`).
- Uses the Host's paired `subagent/start` and `subagent/end` events to defer
  review while the parent owns an active native run, including custom-named
  expert tools. Legacy background jobs use tool results and inbox notices.

## Security model

- The reviewer runs in a fresh context and receives only the review material
  (user request, candidate answer). It does not inherit the primary agent's
  hidden reasoning.
- A read-only deployment must constrain both the reviewer and the workers it
  can start. For native subagents, choose a suitable Agent Preset. For domain
  experts, the domain allow-list limits inherited tools on a managed child.
  Its preset can also contribute local tools. Explicit domain denials apply at
  execution, including to local tools registered later.
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
