# dsh-answer-review-gate

## Status

Backlog / planned.

## Goal

Добавить в DeepSeek Harness обязательный независимый review gate для пользовательских ответов агента.

Перед тем как substantive response считается финальным, отдельный reviewer должен проверить его на:

- factual correctness;
- соответствие документации и исходному коду;
- unsupported claims;
- потерянные qualifiers и ограничения;
- устаревшие данные;
- поверхностный поиск;
- противоречащие authoritative sources;
- принятие предположений пользователя за факты;
- false certainty;
- неполное покрытие вопроса.

Главная задача плагина — сделать review **lifecycle requirement**, а не пожеланием в system prompt.

---

# Problem

Системная инструкция вида:

> Before answering, ask a reviewer.

не является достаточным enforcement mechanism.

Primary agent может:

- забыть выполнить review;
- решить, что задача слишком простая;
- завершить промежуточный turn;
- вызвать background subagents и закончить turn сообщением ожидания;
- ошибочно решить, что уже получил достаточно evidence;
- принять reviewer feedback без собственной проверки;
- попасть в бесконечный review/revision loop.

Плагин должен отделить:

1. промежуточный orchestration turn;
2. настоящий candidate final answer;
3. review;
4. исправление;
5. разрешение на завершение turn.

---

# User-facing behavior

Обычный успешный flow:

```text
User
  ↓
Primary agent
  ↓
research / tools / subagents
  ↓
candidate answer
  ↓
answer-review-gate
  ↓
Reviewer
  ├─ PASS ──────────────► turn may finish
  │
  └─ REVISE
       ↓
   reviewer feedback
       ↓
   primary agent
       ↓
   corrected candidate
       ↓
   review again
```

Review должен быть незаметен пользователю по умолчанию, кроме optional UI-индикации.

Пользователь получает только исправленный final answer.

## Явный waiver на один запрос

Пользователь может явно отправить один запрос без автоматического review:

```text
/no-review <request>
```

Это host command, а не фраза, которую primary agent или gate интерпретирует из
текста. Обработчик команды:

1. пишет штатный `command/run` с human source и без `args`
   (`recordInput: false`);
2. через `agent.followup` создаёт обычный human `user/message`, а его admission
   сохраняется штатным `agent/inbox/spliced`;
3. возвращает sequence admission-события, и штатный command runtime пишет его
   в `command/done.sourceEventSeq`;
4. показывает пользователю явное предупреждение, что ответ не будет независимо
   проверен.

Gate принимает waiver только при строгой цепочке
`command/run(no-review, user) → agent/inbox/spliced(exact message id) →
command/done(success, sourceEventSeq) → user/message(same id)`. Никакие
нестандартные поля не добавляются в source сообщения. Неуспешная команда,
ссылка на другое сообщение, старый lifecycle или текст вроде «ревью не нужно»
не являются waiver. Поэтому quoted text, отрицание и обсуждение самой функции
никогда не отключают review случайно. Команда принимает штатные вложения и
действует только на созданный ею запрос.

Deployment policy может полностью отключить waiver. При `failMode: closed` он
по умолчанию запрещён и разрешается только отдельной настройкой
`waiver.allowedInClosedMode`.

---

# Critical subagent lifecycle requirement

Gate НЕ должен считать каждый `agent/turn-stopping` финальным ответом.

Пример:

```text
Turn 1
  primary starts A and B in background
  primary: "Waiting for delegated research."
  turn-stopping
  pendingChildren = 2
  → DO NOT REVIEW
  → allow turn to close

A settles
  ↓
subagent-settled
  ↓
Turn 2
  primary handles A
  B still active
  turn-stopping
  pendingChildren = 1
  → DO NOT REVIEW

B settles
  ↓
Turn 3
  primary synthesizes final answer
  turn-stopping
  pendingChildren = 0
  → REVIEW
```

No text heuristics such as detecting:

- "I'll wait";
- "дождусь";
- "вернусь с ответом";

should participate in this decision.

The decision must be based on runtime state.

---

# Architecture

Initial architecture:

```text
Host plugin
│
├─ Turn Gate
│    └─ agent/turn-stopping
│
├─ Delegation Tracker
│    ├─ tools/result
│    └─ agent/inbox/inserted
│
├─ Candidate Collector
│
├─ Reviewer Runner
│    ├─ domain expert adapter
│    └─ native subagent adapter
│
├─ Verdict Parser
│
├─ Revision Controller
│    └─ agent.steer(...)
│
├─ Session State
│
└─ Metrics / Audit
```

The first release does not require a client UI.

---

# DSH integration points

## `agent/turn-stopping`

Primary enforcement point.

At this boundary the plugin determines whether the candidate may finish.

Pseudo-flow:

```ts
ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
  if (!shouldReview(agent, turn)) return

  const candidate = collectCandidate(agent, turn)
  const verdict = await review(candidate, signal)

  if (verdict.kind === 'revise') {
    agent.steer({
      source: {
        kind: 'plugin',
        plugin: 'dsh-answer-review-gate',
      },
      content: [{
        type: 'text',
        text: renderReviewFeedback(verdict),
      }],
    })
  }
})
```

## `tools/result`

Observe delegation tool results.

For continuable background subagents the official tool returns a structured result containing the child subagent id.

The plugin should record that id as pending work belonging to the parent session.

Do not parse rendered human-readable text such as `started subagent ...` if structured output is available.

## `agent/inbox/inserted`

Observe runtime notices.

In particular:

```text
source.kind = subagent-settled
```

Use:

```text
message.source.senderSessionId
```

to resolve the pending child.

Future-compatible handling should also understand `subagent-waiting` as "still pending", not as settlement.

## `session/event`

Use durable session events when needed to reconstruct:

- latest assistant candidate;
- turn boundaries;
- review audit records;
- crash/restart state.

Do not duplicate durable facts into custom state unnecessarily.

---

# Session state

Minimum runtime state:

```ts
interface ReviewSessionState {
  pendingDelegations: Map<string, PendingDelegation>

  candidateHash?: string
  lastPassedHash?: string

  reviewRound: number
  reviewInProgress: boolean

  lastVerdict?: ReviewVerdict
}
```

`reviewRound` and `lastPassedHash` are scoped to the **user turn**: the surface
seq of the user request the candidate answers. One user request spends several
agent turns — a steered revision continues the current one, a settlement notice
opens a new one — so agent turns must never reset the round budget or the PASS
receipt. Keyed by the agent turn instead, a candidate that had already passed
was reviewed again on the next boundary and every turn handed out a fresh round
budget, which is how the reviewer and the primary ended up alternating forever.
An unknown user turn (no real user message found yet) never resets a known one,
so an interim boundary without a candidate cannot hand out a fresh budget
either.

Delegation entry:

```ts
interface PendingDelegation {
  id: string
  kind: 'continuable-subagent' | 'background-job'
  createdAtTurn: number

  status:
    | 'running'
    | 'waiting'
    | 'settled'
    | 'failed'
    | 'aborted'
}
```

Review PASS must apply to the exact candidate content.

Use a stable digest:

```text
SHA-256(normalized candidate)
```

If the answer changes after PASS, the old PASS is invalid.

---

# shouldReview()

Conceptually:

```ts
function shouldReview(ctx): boolean {
  if (!config.enabled)
    return false

  if (isReviewerAgent(ctx.agent))
    return false

  if (ctx.state.reviewInProgress)
    return false

  if (hasPendingDelegations(ctx))
    return false

  if (!hasMaterialAssistantCandidate(ctx))
    return false

  if (candidateAlreadyPassed(ctx))
    return false

  if (matchesExcludedAgent(ctx))
    return false

  return true
}
```

The reviewer itself MUST be exempt from the gate.

Otherwise:

```text
reviewer
  → reviewer
      → reviewer
          → ...
```

---

# Reviewer isolation

Reviewer must run in fresh context.

It must receive only the data required to perform the review:

```text
user request
candidate answer
available evidence bundle
source references
relevant tool/research summary
```

It should NOT inherit the primary agent's hidden reasoning.

Ideally reviewer uses:

- another model/provider;
- strong reasoning;
- read-only tools;
- no modification/deployment tools;
- no unrestricted shell;
- no ability to recursively invoke itself.

Correlated model failures should be reduced where economically reasonable by using a reviewer route different from primary.

---

# Reviewer contract

Reviewer is an adversarial verifier, not a second answering agent.

Expected structured result:

```ts
interface ReviewVerdict {
  verdict: 'pass' | 'revise'

  issues: ReviewIssue[]

  unsupportedClaims: UnsupportedClaim[]
  missedChecks: MissedCheck[]

  confidence: 'low' | 'medium' | 'high'
}

interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor'

  category:
    | 'factually-wrong'
    | 'unsupported'
    | 'contradicted'
    | 'outdated'
    | 'overstated'
    | 'missing-qualification'
    | 'weak-source'
    | 'search-incomplete'
    | 'user-assumption'
    | 'question-not-covered'

  claim: string
  problem: string

  evidence?: EvidenceReference[]
  requiredFix: string
}
```

Reviewer should not rewrite the entire answer unless explicitly requested by the review protocol.

Its normal product is:

```text
diagnosis + evidence + required correction
```

---

# Review policy

A reviewer MUST treat the candidate as untrusted.

Support for a claim is not established merely because:

- primary said it confidently;
- primary supplied a citation;
- one search result agrees;
- the user assumed it;
- another AI previously said it.

For material factual claims the reviewer should attempt to establish:

```text
claim
  ↓
best available source
  ↓
does source actually entail claim?
  ↓
newer/contradicting source?
  ↓
scope/version/preconditions preserved?
```

Lack of evidence is itself a valid finding.

The reviewer does not need to prove a claim false in order to classify it as unsupported.

---

# Evidence priority

Default priority:

```text
source code / canonical runtime behavior
official documentation
official release notes / changelog
maintainer issue/discussion
primary-source external documentation
high-quality secondary source
search result / aggregator
```

Search snippets alone should not normally satisfy a material factual claim when stronger evidence is available.

---

# Revision behavior

On `REVISE`:

1. Feed structured findings back to primary with `agent.steer`.
2. Primary checks the reviewer's evidence.
3. Primary corrects supported findings.
4. Unsupported reviewer objections may be rejected only after re-verification.
5. Materially changed candidate is reviewed again.

Default maximum:

```text
maxReviewRounds = 3
```

After exceeding the maximum, apply configured failure policy.

---

# Failure policy

Configurable:

```text
failMode:
  open
  warn
  closed
```

### `open`

Reviewer failure does not stop final response.

Audit the failure.

### `warn`

Allow final response but inject an instruction requiring the primary to explicitly qualify that independent verification could not be completed.

Recommended development default.

### `closed`

Do not allow the answer through without successful review.

Recommended eventual QA-surface production mode after the implementation is proven stable.

Reviewer infrastructure failure must never be converted into an invented PASS.

---

# Proposed configuration

```ts
interface Config {
  enabled: boolean

  reviewer: {
    backend: 'domain-expert' | 'subagent'
    domain?: string
    provider?: string
    model?: string
    reasoningEffort?: string
  }

  maxReviewRounds: number

  failMode:
    | 'open'
    | 'warn'
    | 'closed'

  trackBackgroundDelegations: boolean

  reviewPolicy:
    | 'all-substantive'
    | 'factual'
    | 'external-claims'

  excludedAgents: string[]

  waiver: {
    enabled: boolean
    allowedInClosedMode: boolean
  }

  audit: {
    enabled: boolean
    maxEntries: number
  }
}
```

Suggested defaults:

```yaml
enabled: true

reviewer:
  backend: domain-expert
  domain: answer-reviewer

maxReviewRounds: 3
failMode: warn

trackBackgroundDelegations: true
reviewPolicy: all-substantive

excludedAgents:
  - answer-reviewer

waiver:
  enabled: true
  allowedInClosedMode: false

audit:
  enabled: true
  maxEntries: 500
```

---

# Domain Experts integration

First implementation should support:

```text
reviewer.backend = domain-expert
```

and invoke an existing configured reviewer from `dsh-domain-experts`.

This has two advantages:

1. reviewer persona/policy/model can be tuned independently;
2. the future gate plugin does not need to own expert configuration.

Later a direct native-subagent adapter may be added.

The gate MUST NOT depend on human-readable names. Store/use stable domain id.

---

# Candidate evidence bundle

Phase 1 may send:

```text
user request
candidate answer
```

Phase 2 should add an evidence bundle:

```ts
interface EvidenceBundle {
  sources: SourceReference[]
  toolExecutions: RelevantToolExecution[]
  delegatedResearch: DelegationOutcome[]
}
```

The reviewer must remain allowed to perform independent research.

The evidence bundle is evidence of what primary checked, not an authority ceiling for reviewer research.

---

# Background subagents

The plugin must explicitly cover:

```text
continuable background subagents
one-shot background jobs
foreground subagents
nested subagents
failed children
aborted children
waiting children
multiple parallel children
settlement notices arriving while parent is busy
```

A direct parent only needs to track work it owns.

Nested descendants should normally be represented by their owning child's lifecycle instead of flattening the entire delegation tree into the root.

---

# Concurrency

`reviewInProgress` must be atomic per parent session.

Two racing stop boundaries must not spawn two reviewers for the same candidate hash.

Recommended key:

```text
sessionId + turn + candidateHash
```

Deduplicate review attempts on this key.

---

# Persistence / restart

Phase 1 may keep ephemeral state if DSH guarantees active review work dies with the process.

Before production `failMode: closed`, pending state and successful PASS receipts should become replayable/durable.

Never persist a PASS without:

```text
candidateHash
reviewer identity/version
timestamp
verdict
```

---

# Audit

Record:

```text
session
turn
candidate hash
review round
reviewer
review duration
verdict
issue counts
failure type
waiver reason
```

Do not persist full prompts/responses by default if they may contain sensitive content.

Waiver audit records contain only candidate hash and metadata. They must not
contain the command input or user request text.

---

# UI — optional Phase 2

Small final-answer badge:

```text
✓ Reviewed
2 review rounds
3 findings corrected
```

Expandable panel:

```text
Reviewer
Model
Review rounds
Issues
Evidence
Final verdict
```

Possible states:

```text
Reviewed
Reviewing
Revision requested
Review unavailable
Review bypassed
```

---

# Metrics

Useful counters:

```text
reviews_total
reviews_pass_total
reviews_revise_total

review_rounds
review_latency_ms

issues_total{category,severity}

review_failures_total{reason}

answers_bypassed_total{reason}
```

Later this can answer questions such as:

```text
Which models generate the most unsupported documentation claims?
Which sources are most often misread?
How often does reviewer catch stale documentation?
How many review rounds are typically needed?
```

---

# Security

Reviewer should be read-only by default.

It must not:

- deploy;
- commit;
- modify files;
- mutate user data;
- execute arbitrary shell commands unless explicitly required;
- escalate permissions;
- alter the gate;
- approve itself.

Reviewer output is untrusted model output and must be parsed/validated.

A malformed verdict is a reviewer failure, not PASS.

---

# Testing

## Unit tests

Cover:

```text
pending delegation suppresses review
last child settlement enables review
PASS allows turn close
REVISE causes steer
candidate hash change invalidates PASS
same hash does not review twice
reviewer agent is excluded
max rounds enforced
review failure obeys failMode
malformed verdict never becomes PASS
plain text never infers a waiver
waiver requires matching successful command lifecycle
failed/unlinked/replayed command lifecycles are rejected
waiver survives restart from the durable log
closed-mode waiver policy is enforced
```

## Lifecycle tests

Use scripted LLMs.

Cases:

```text
ordinary answer

foreground subagent → answer

background A → interim turn → settlement → final answer

parallel A+B → A settles → still no review → B settles → review

nested delegation

reviewer REVISE → correction → PASS

reviewer failure

primary tries to finish while review is active
```

## Real-host acceptance

Run against an actual DSH profile using `spawn`.

Inspect durable session log to confirm:

```text
intermediate waiting turns are not reviewed
one final PASS corresponds to exact final candidate
no recursive reviewer spawn
no orphan child agents
```

---

# Suggested repository structure

```text
plugins/dsh-answer-review-gate/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── gate.ts
│   ├── candidate.ts
│   ├── delegation-tracker.ts
│   ├── review-runner.ts
│   ├── verdict.ts
│   ├── state.ts
│   ├── audit.ts
│   └── adapters/
│       ├── domain-expert.ts
│       └── subagent.ts
│
├── tests/
│   ├── gate.test.ts
│   ├── delegation.test.ts
│   ├── verdict.test.ts
│   └── integration.test.ts
│
├── SPEC.md
├── README.md
├── compatibility.json
├── cordis.patch.yml
├── package.json
└── project.json
```

Package:

```text
@yadsh/dsh-answer-review-gate
```

Runtime plugin id:

```text
dsh-answer-review-gate
```

---

# Implementation phases

## Phase 1 — MVP

Implement:

```text
turn-stopping gate
domain-expert reviewer
candidate hashing
REVISE via steer
round limit
recursion protection
basic background-subagent awareness
tests
```

No client UI.

## Phase 2 — hardened lifecycle

Add:

```text
durable/replayable state
full one-shot + continuable tracking
evidence bundle
structured-output reviewer contract
metrics
failure diagnostics
```

## Phase 3 — UI / observability

Add:

```text
Reviewed badge
review panel
issue history
metrics export
```

---

# Acceptance criteria

MVP is complete when all of the following hold:

1. A normal substantive answer is independently reviewed before completion.
2. A background-subagent waiting turn is not reviewed.
3. Review starts only after owned background work needed for the answer has settled.
4. `REVISE` forces another primary step.
5. Modified answers invalidate previous PASS.
6. Reviewer cannot recursively review itself.
7. Reviewer failure never silently becomes PASS.
8. Review loop has a hard maximum.
9. Primary remains responsible for checking reviewer evidence rather than blindly obeying it.
10. No changes to DSH core are required.
11. `/no-review <request>` suppresses review only for the exact request linked
    through `command/done.sourceEventSeq` and emits an auditable `waived`
    outcome without prompt text.
12. Natural-language mentions of skipping review never alter gate policy.
