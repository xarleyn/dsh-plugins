# SPEC: `dsh-user-correction-miner`

> **Статус (2026-09-05):** Фаза 1 реализована и выпущена (v0.1.0 — evidence mining, команды `/corrections*`). Фазы 2+ (кластеризация → кандидаты правил → authority-анализ → replay) остаются дорожной картой; этот документ — источник истины для полного замысла.

## 1. Summary

`dsh-user-correction-miner` — плагин для DeepSeek Harness, который анализирует историю пользовательских исправлений агента и превращает повторяющиеся или явно долговечные коррекции в **кандидатов проектных правил**.

Примеры исходных коррекций:

- «не тот файл»
- «не трогай `public/`»
- «не запускай deploy»
- «используй pnpm, не npm»
- «не меняй generated-файлы руками»
- «сначала запускай typecheck»
- «для этого проекта не используй Docker Compose напрямую»
- «не коммить без моего разрешения»

Плагин не должен автоматически обучать агента или самостоятельно менять его полномочия.

Главный pipeline:

```text
session history
    ↓
correction detection
    ↓
evidence extraction
    ↓
deduplication / clustering
    ↓
rule candidate
    ↓
authority + safety analysis
    ↓
offline historical replay
    ↓
candidate score
    ↓
human review
    ↓
AGENTS.md / scoped rule / Skill diff
    ↓
explicit user approval
    ↓
apply
```

Ключевой принцип:

> **Observation is automatic. Authority is not.**

Плагин может автоматически обнаруживать, анализировать, группировать и тестировать правила, но изменение durable instructions всегда требует явного решения пользователя.

---

# 2. Goals

## 2.1 Primary goal

Снизить количество повторных исправлений агента за счёт превращения устойчивых пользовательских коррекций в проверенные проектные правила.

## 2.2 Secondary goals

Плагин должен:

1. находить коррекции как в текущих, так и в прошлых сессиях;
2. отличать реальную долговременную коррекцию от одноразовой команды;
3. сохранять provenance:
   - session id;
   - event seq;
   - исходную фразу пользователя;
   - контекст ошибочного действия агента;
4. объединять дублирующиеся коррекции;
5. определять предполагаемый scope правила;
6. формировать минимальное правило;
7. проверять правило на исторических сессиях;
8. выявлять потенциальные regressions;
9. показывать человеку evidence + replay report + diff;
10. применять изменение только после явного approval.

---

# 3. Non-goals

Первая версия **не должна**:

- автоматически редактировать `AGENTS.md`;
- автоматически создавать или изменять `SKILL.md`;
- автоматически менять permission configuration DSH;
- включать новые tools;
- расширять filesystem scope;
- давать агенту network access;
- снимать approval requirements;
- разрешать deploy/push/commit;
- изменять sandbox configuration;
- автоматически выполнять найденные «рекомендации»;
- использовать corrections как безусловную long-term memory;
- мутировать старые session logs;
- переписывать system prompt;
- самостоятельно исправлять действия текущего агента в realtime.

Это **mining/recommendation system**, а не self-modifying agent.

---

# 4. Fundamental security invariant

## 4.1 No automatic authority expansion

Плагин должен иметь отдельный детерминированный `AuthorityGate`.

Каждый кандидат классифицируется как:

```ts
type AuthorityDelta =
  | 'restrictive'
  | 'neutral'
  | 'expansive'
  | 'unknown'
```

### Restrictive

Правило уменьшает допустимое множество действий.

Примеры:

```text
Do not deploy unless explicitly requested.
Do not modify generated files manually.
Ask before pushing to remote.
Only edit files inside packages/foo/.
```

Допускается к дальнейшему анализу.

### Neutral

Меняет предпочтительный способ выполнения уже разрешённой операции.

Примеры:

```text
Use pnpm instead of npm.
Run pnpm lint before pnpm test.
Prefer existing repository helpers over new scripts.
```

Допускается к дальнейшему анализу.

### Expansive

Расширяет допустимое множество действий.

Примеры:

```text
You may deploy without asking.
It is okay to bypass tests.
You may access directories outside the workspace.
Use sudo whenever necessary.
Push directly to main.
Ignore existing approval rules.
```

**Автоматически блокируется.**

Статус:

```text
blocked_authority_expansion
```

Даже если такая инструкция действительно встречалась в сообщении пользователя, miner не должен превращать её в автоматически предлагаемый durable rule.

Пользователь может самостоятельно изменить соответствующий configuration/policy вне miner'а.

### Unknown

Если классификатор не может доказать, что изменение restrictive/neutral:

```text
unknown → blocked
```

Fail closed.

---

# 5. AGENTS.md is not a permission system

Необходимо явно разделять:

```text
behavioral guidance
vs
security enforcement
```

`AGENTS.md` влияет на поведение модели, но не должен рассматриваться как security boundary.

Поэтому correction:

```text
"не запускай deploy"
```

может породить:

```md
- Do not run deployment commands unless the user explicitly requests deployment.
```

но UI дополнительно должен показать:

```text
Hard-policy candidate

This rule controls model behavior only.
Consider enforcing the same restriction at tools/pre-execute.
```

Плагин **не должен автоматически создавать такой policy hook**.

В будущем это может стать интеграцией с отдельным policy plugin.

---

# 6. DSH integration

DSH уже предоставляет подходящие extension points.

Session является append-only event log, а model history является его projection, поэтому miner не должен заводить собственную копию conversation history.

Для historical corpus использовать:

```text
ctx.sessionQuery
```

в частности:

```ts
listSessions()
readSession(sessionId)
filterSessions(...)
searchSessions(...)
searchEvents(...)
```

`readSession()` возвращает detached raw log и не требует поднимать старую сессию в live session store, что идеально для offline analysis.

Для новых событий:

```text
session/event
```

и/или lifecycle события:

```text
turn/end
session/disposed
```

Для realtime-path miner не должен блокировать `agent/pre-step`.

## Recommended processing model

```text
session/event: user/message
        ↓
cheap correction prefilter
        ↓
mark pending evidence
        ↓
turn/end
        ↓
enqueue analysis
```

Это позволяет не добавлять latency непосредственно перед model request.

---

# 7. Pipeline

## Stage A — Correction detection

На входе:

```ts
interface CorrectionEvidence {
  sessionId: string
  userEventSeq: number

  userText: string

  previousAssistantEvents: number[]
  previousToolEvents: number[]

  cwd: string
  timestamp: number
}
```

Detector должен использовать двухступенчатую схему.

### Tier 1 — deterministic prefilter

Cheap heuristics ищут конструкции вроде:

```text
не ...
не надо ...
не тот ...
зачем ты ...
я же просил ...
используй X
не используй X
вместо X используй Y
всегда ...
никогда ...
сначала ...
не запускай ...
не меняй ...
не трогай ...
don't ...
never ...
use X instead ...
```

Heuristics **не создают правило**.

Они только уменьшают объём сообщений, отправляемых semantic classifier'у.

### Tier 2 — semantic correction classifier

Выход должен быть строго typed:

```ts
interface CorrectionClassification {
  isCorrection: boolean

  confidence: number

  target:
    | 'file-selection'
    | 'filesystem-scope'
    | 'tool-choice'
    | 'command'
    | 'workflow'
    | 'package-manager'
    | 'git'
    | 'deploy'
    | 'style'
    | 'testing'
    | 'environment'
    | 'agent-behavior'
    | 'other'

  durability:
    | 'one-off'
    | 'likely-project-rule'
    | 'likely-user-rule'
    | 'likely-skill'
    | 'uncertain'

  severity:
    | 'preference'
    | 'workflow'
    | 'destructive-risk'
    | 'security'

  correctedBehavior?: string
}
```

---

# 8. Context extraction

Нельзя анализировать только последнюю фразу пользователя.

Например:

```text
Agent:
I'll update packages/web/package.json.

User:
Не тот файл.
```

Без контекста correction бессмысленна.

Поэтому extractor получает bounded trace:

```text
previous user instruction
assistant reasoning/message
relevant tool calls
tool results
correction
```

Необходим relationship-aware context.

Пример:

```yaml
correction:
  text: "не тот файл"

target_action:
  type: write
  path: packages/web/package.json

original_request:
  mentioned_path: packages/server/package.json

inferred_correction:
  expected_behavior:
    "When the user names a specific file, do not substitute a similarly named file."
```

---

# 9. One-off vs durable rule

Это одна из главных задач miner'а.

Нельзя превращать:

```text
"Не запускай тесты сейчас."
```

в:

```text
Never run tests.
```

## Signals for durable rules

Положительные:

- «в этом проекте»;
- «всегда»;
- «никогда»;
- «мы используем ...»;
- «у нас принято ...»;
- аналогичная correction встречалась раньше;
- correction соответствует repository evidence;
- исправляется систематическая ошибка агента.

Отрицательные:

- «сейчас»;
- «в этот раз»;
- «пока не надо»;
- сильно task-specific context;
- ephemeral branch/file state;
- correction зависит от временной ситуации.

---

# 10. Repository validation

До генерации durable rule miner должен попытаться подтвердить correction проектом.

Например:

```text
User:
Используй pnpm.
```

Miner проверяет:

```text
pnpm-lock.yaml
package.json#packageManager
pnpm-workspace.yaml
existing AGENTS.md
README
CI workflows
```

Если обнаружено:

```json
{
  "packageManager": "pnpm@11.7.0"
}
```

confidence увеличивается.

Если обнаружен только:

```text
package-lock.json
```

candidate помечается:

```text
repository evidence conflicts with correction
```

и требует более осторожного review.

Важно:

**repository state — evidence, а не authority.**

Прямая команда пользователя всё равно может быть корректнее состояния repository.

---

# 11. Candidate generation

После normalization похожие corrections собираются в cluster.

Например:

```text
"используй pnpm"
"опять npm? тут pnpm"
"не npm install, pnpm install"
```

дают:

```yaml
candidate:
  concept: package-manager
  normalizedRule: Use pnpm for Node.js dependency and script operations in this repository.

evidenceCount: 3
```

---

# 12. Minimal-rule principle

Generator должен стремиться не к максимально общему, а к **минимальному правилу, объясняющему evidence**.

Плохо:

```text
Always carefully follow project conventions and use the correct tools.
```

Хорошо:

```text
Use pnpm rather than npm for package installation and package scripts.
```

Плохо:

```text
Never perform dangerous operations.
```

Хорошо:

```text
Do not run deployment commands unless deployment is explicitly requested.
```

---

# 13. Rule categories

Предлагается внутренне разделять:

```ts
type CandidateKind =
  | 'instruction'
  | 'path-rule'
  | 'skill'
  | 'hard-policy-suggestion'
```

## instruction

Обычное правило для `AGENTS.md`.

## path-rule

Правило действует только на определённое дерево:

```text
packages/mobile/**
```

Если установлен `dsh-rules`, можно предложить `.dsh/rules/*.md`: этот plugin уже поддерживает glob-activated rules и path-specific sections.

Без `dsh-rules` fallback:

```text
nested AGENTS.md
```

например:

```text
packages/mobile/AGENTS.md
```

DSH нативно поддерживает hierarchy `AGENTS.md` от project root к рабочему каталогу/поддереву.

## skill

Если правило относится не ко всему проекту, а к определённому типу задач:

```text
When preparing a release ...
When working with database migrations ...
When performing dependency updates ...
```

miner должен предложить Skill draft, а не раздувать project `AGENTS.md`.

В MVP Skill только предлагается.

## hard-policy-suggestion

Используется для corrections вида:

```text
не deploy
не push
не удаляй
не трогай prod
```

Создаёт behavioral rule плюс предупреждение, что для настоящей гарантии нужен tool-level policy.

---

# 14. Deduplication

Каждый новый candidate сравнивается с:

1. существующим `AGENTS.md`;
2. nested `AGENTS.md`;
3. `.dsh/rules`;
4. pending candidates;
5. rejected candidates;
6. ранее accepted rules.

Результаты:

```ts
type CandidateRelation =
  | 'new'
  | 'duplicate'
  | 'reinforcement'
  | 'refinement'
  | 'contradiction'
  | 'supersedes'
```

Пример:

Existing:

```text
Use pnpm.
```

New:

```text
Use pnpm instead of npm.
```

Не создавать новое правило.

Статус:

```text
reinforcement
```

и увеличить evidence count существующего.

---

# 15. Candidate provenance

У каждого правила должна быть explainability chain:

```text
Rule
  ├── correction A
  │    └── session / event seq
  ├── correction B
  │    └── session / event seq
  ├── repository evidence
  └── replay runs
```

Пример UI:

```text
Use pnpm instead of npm.

Why?

3 corrections in 2 sessions

#82
"используй pnpm"

#133
"опять npm? тут pnpm"

#201
"не npm install"

Repository:
✓ pnpm-lock.yaml
✓ packageManager = pnpm@11.7.0
```

Ни один rule candidate не должен существовать без provenance.

---

# 16. Offline replay

Это основное отличие от обычной memory/self-evolution системы.

Перед рекомендацией durable rule miner проверяет:

> Если бы это правило существовало раньше, стало бы поведение агента лучше или оно начало бы ломать корректные задачи?

---

# 17. Replay levels

Предлагаются три уровня.

## Level 0 — static matching

Без LLM.

Проверяем исторический corpus:

```text
Где candidate потенциально был бы активен?
Какие действия попадали под него?
Есть ли очевидные конфликты?
```

Пример:

Candidate:

```text
Do not modify migrations.
```

Но в 18 прошлых задачах пользователь явно просил:

```text
Create migration ...
```

Высокий regression risk.

---

## Level 1 — evaluator replay

Берётся контекст старой ситуации непосредственно перед ошибочным решением.

Сравниваются:

```text
baseline trace
candidate-aware expected behavior
```

Evaluator отвечает структурированно:

```ts
interface ReplayEvaluation {
  wouldApply: boolean
  wouldPreventCorrection: boolean

  regressionRisk: number
  overreachRisk: number

  reason: string
}
```

Это самый дешёвый MVP replay.

---

## Level 2 — counterfactual model replay

Воссоздаётся model context до выбранного historical step.

Делаются два isolated calls:

```text
A: historical instructions
B: historical instructions + candidate
```

Сравнивается proposed next action.

### Critical rule

Replay environment:

```text
NO real side effects
```

Запрещено выполнять:

- filesystem writes;
- git writes;
- network requests;
- deploy;
- shell side effects;
- external APIs;
- MCP mutations.

Tool calls должны:

1. либо использовать recorded historical results;
2. либо работать через read-only sandbox;
3. либо завершаться synthetic result'ом.

Никакого реального `deploy` ради проверки правила «не делай deploy».

---

# 18. Replay snapshots

Полный environment replay не всегда возможен: repository мог измениться.

Поэтому использовать capabilities по уровням.

### Transcript replay

Всегда доступен.

Использует только event log.

### Git replay

Если известен historical revision:

```text
git worktree
historical commit
read-only tools
```

Можно использовать для более качественного evaluation.

### Unsupported replay

Если невозможно надежно восстановить environment:

```text
replayConfidence = low
```

Это не ошибка.

UI просто показывает меньшую confidence.

---

# 19. Replay corpus selection

Не следует прогонять каждое правило по тысячам сессий.

Corpus builder выбирает:

```text
positive cases
near misses
negative controls
random controls
```

### Positive

Сессии с аналогичной correction.

### Near miss

Похожие задачи, где correction не было.

### Negative controls

Задачи, где candidate потенциально мог бы навредить.

### Random controls

Несколько случайных project sessions.

Defaults:

```yaml
replay:
  positiveCases: 5
  nearMissCases: 10
  negativeControls: 10
  randomControls: 5
```

---

# 20. Replay scoring

Итоговая оценка:

```text
candidate score
 =
 correction prevention
 + evidence strength
 + repository support
 + repeated occurrence
 - regression risk
 - overbreadth
 - contradiction risk
 - authority uncertainty
```

Не требуется делать score абсолютной истиной.

Он нужен для сортировки review queue.

Например:

```text
Confidence: 0.91

Historical evidence:      0.94
Correction prevention:    0.96
Repository support:       1.00
Regression risk:          0.04
Scope uncertainty:        0.08
Authority risk:           0.00
```

---

# 21. Candidate states

```ts
type CandidateStatus =
  | 'detected'
  | 'clustered'
  | 'draft'
  | 'blocked_authority_expansion'
  | 'blocked_conflict'
  | 'replaying'
  | 'needs_more_evidence'
  | 'ready_for_review'
  | 'accepted'
  | 'rejected'
  | 'snoozed'
  | 'superseded'
```

---

# 22. Human review UX

Рекомендую browser half плагина.

DSH позволяет внешнему плагину добавлять собственные элементы Settings и отдельные tabs через client slot infrastructure; Host и browser half могут находиться в одном plugin package.

## Settings → Plugins → Corrections

Основная страница:

```text
Corrections

Ready for review       4
Needs more evidence    7
Blocked                2
Accepted              13
Rejected               6
```

---

# 23. Candidate card

Пример:

```text
────────────────────────────────────────

Use pnpm instead of npm

Target
AGENTS.md

Scope
project-wide

Type
neutral convention

Evidence
3 corrections / 2 sessions

Replay
12 / 12 positive
0 / 16 regressions

Repository evidence
✓ pnpm-lock.yaml
✓ packageManager: pnpm@11.7.0

Proposed change

+ ## Package management
+ Use pnpm instead of npm for package installation
+ and package scripts.

[Open evidence]
[Edit]
[Reject]
[Snooze]
[Apply]

────────────────────────────────────────
```

---

# 24. Explicit apply flow

`Apply` не должен сразу blindly писать файл.

Flow:

```text
click Apply
    ↓
read current AGENTS.md
    ↓
compare content hash with proposal base
    ↓
regenerate diff if necessary
    ↓
show final diff
    ↓
explicit Confirm
    ↓
atomic write
```

Если файл изменился:

```text
Proposal is stale.
AGENTS.md changed since this candidate was created.
```

Пользователь должен увидеть regenerated diff.

---

# 25. Editing candidates

Перед acceptance пользователь может отредактировать proposed rule.

После ручного изменения:

```text
authority analysis → rerun
replay → optionally rerun
```

Если пользователь превратил:

```text
Do not deploy automatically.
```

в:

```text
You may deploy automatically.
```

candidate не должен тихо сохранить прежний green badge.

Authority classification должен измениться на:

```text
expansive
```

---

# 26. Applying rules

Default:

```yaml
apply:
  automatic: false
  requireExplicitConfirmation: true
  createBackup: true
```

Можно создавать:

```text
AGENTS.md.bak
```

или хранить previous content в plugin storage.

Но лучше не плодить `.bak` в repository без необходимости.

Предпочтительнее internal rollback record:

```text
candidate id
previous hash
previous content
new hash
timestamp
```

---

# 27. Rule placement

Placement engine:

```text
correction
    ↓
scope inference
    ├── all projects → suggest global, never auto
    ├── repository → root AGENTS.md
    ├── subtree → nested AGENTS.md / dsh-rules
    └── task type → Skill
```

## Important

Первая версия должна **по умолчанию майнить только project-scoped rules**.

Global `$DSH_HOME/AGENTS.md` значительно опаснее.

Для global promotion должно требоваться отдельное explicit action:

```text
Promote to user-global rule
```

и минимум несколько independent project occurrences.

---

# 28. Suggested persistence model

Использовать `ctx.storageDomain`, поскольку DSH предоставляет его именно для durable plugin-owned state, не являющегося session history.

Domain:

```text
dsh_user_correction_miner
```

Tables:

```text
corrections
clusters
candidates
replays
decisions
rule_bindings
```

---

# 29. Data model

```ts
interface CorrectionRecord {
  id: string

  sessionId: string
  eventSeq: number

  workspaceId?: string
  cwd: string

  text: string
  contextDigest: string

  classification: CorrectionClassification

  createdAt: number
}
```

```ts
interface RuleCandidate {
  id: string

  workspaceKey: string

  kind: CandidateKind

  title: string
  proposedRule: string

  scope: {
    type: 'project' | 'subtree' | 'skill' | 'global'
    path?: string
  }

  authority: AuthorityDelta

  evidenceIds: string[]

  confidence: number

  targetFile?: string

  baseFileHash?: string

  status: CandidateStatus

  createdAt: number
  updatedAt: number
}
```

```ts
interface ReplayRun {
  id: string
  candidateId: string

  sessionId: string

  mode:
    | 'static'
    | 'evaluator'
    | 'counterfactual'
    | 'git-snapshot'

  wouldApply: boolean
  correctionPrevented?: boolean

  regressionRisk: number
  overreachRisk: number

  result:
    | 'pass'
    | 'fail'
    | 'inconclusive'

  details: string

  createdAt: number
}
```

```ts
interface ReviewDecision {
  candidateId: string

  action:
    | 'accept'
    | 'edit-accept'
    | 'reject'
    | 'snooze'
    | 'mark-one-off'

  finalRule?: string

  actor: 'human'

  timestamp: number
}
```

---

# 30. Rejected candidate memory

Очень важно не предлагать одно и то же бесконечно.

При Reject сохраняется fingerprint:

```text
normalized concept
scope
semantic fingerprint
reason
```

Новая аналогичная correction:

```text
rejected once
    ↓
increase evidence
    ↓
do NOT immediately resurface
```

Resurface только если:

```text
new evidence count >= configured threshold
```

например ещё три независимых corrections.

---

# 31. User feedback on miner

При Reject UI спрашивает необязательную причину:

```text
○ One-off situation
○ Rule is wrong
○ Too broad
○ Already documented
○ Do not mine this topic
○ Other
```

Это используется только для miner logic.

Не превращать feedback о miner автоматически в project rule.

---

# 32. Secrets and sensitive data

Correction context может содержать:

- tokens;
- URLs;
- environment values;
- credentials;
- customer information.

Перед сохранением derived evidence и отправкой auxiliary model:

```text
redaction pass
```

Минимум:

```text
Bearer tokens
API keys
credential-looking env vars
private keys
password-like values
```

Raw session остаётся authoritative source.

Miner storage по возможности содержит только:

```text
event references + bounded sanitized snippets
```

а не полные conversation copies.

---

# 33. LLM usage

Архитектура:

```text
deterministic mechanisms first
LLM semantic interpretation second
```

LLM можно использовать для:

- correction classification;
- rule normalization;
- semantic clustering;
- replay evaluation;
- scope suggestion.

LLM нельзя использовать как единственный security check.

Особенно:

```text
AuthorityGate
path validation
apply permission
diff precondition
tool replay sandbox
```

должны быть deterministic.

---

# 34. Model routing

Конфигурация должна позволять отдельную auxiliary model:

```yaml
models:
  classifier: small
  candidateGenerator: small
  replay: main
  evaluator: small
```

Miner не должен по умолчанию тратить frontier model на regex-obvious correction.

---

# 35. Configuration

Пример:

```yaml
- id: dsh-user-correction-miner
  config:
    enabled: true

    retention:
      maxRecordsPerWorkspace: 1000

    live:
      maxPendingSessions: 256
      maxPendingEventsPerSession: 32
      pendingTtlMs: 1800000

    scope:
      projectOnly: true
      allowGlobalSuggestions: false

    mining:
      minCorrectionConfidence: 0.72
      minCandidateEvidence: 1
      repeatedEvidenceThreshold: 2

    analysis:
      useLLM: true
      model: null
      maxContextEvents: 20
      maxContextBytes: 32768

    replay:
      enabled: true
      mode: evaluator
      positiveCases: 5
      nearMissCases: 10
      negativeControls: 10
      randomControls: 5

    authority:
      allowRestrictive: true
      allowNeutral: true
      allowExpansive: false
      unknownPolicy: block

    targets:
      agentsMd: true
      nestedAgentsMd: true
      dshRules: auto
      skills: suggest-only

    review:
      autoApply: false
      requireExplicitApproval: true

    privacy:
      redactSecrets: true
      persistRawMessages: false
```

В Phase 1 durable evidence ограничивается отдельно для каждого workspace:
после вставки удаляются самые старые записи сверх
`retention.maxRecordsPerWorkspace`. Записи других workspaces не участвуют в
подсчёте и не удаляются. Текущий `dsh-storage-domain` не предоставляет
secondary index, поэтому retention при вставке выполняет фильтрованный scan
таблицы; обычный count выполняется одним проходом без materialization и sort.

Live pending state ограничен `live.maxPendingSessions` и
`live.maxPendingEventsPerSession`, а также удаляется после
`live.pendingTtlMs` без событий. Eviction логируется без текста сообщений и
других чувствительных данных. Dispose плагина полностью очищает pending state.

---

# 36. Commands / model tools

Я бы не давал основному агенту write-capable miner tools в MVP.

Человек может получить commands:

```text
/corrections
/corrections scan
/corrections review
```

Если нужны model-facing tools, только read-only:

```text
correction_candidates
correction_evidence
```

Не делать:

```text
correction_accept
correction_apply
```

доступными модели.

Acceptance — только human-facing API/UI.

---

# 37. Manual scan

Нужна возможность:

```text
Scan previous sessions
```

Параметры:

```text
current workspace
last N sessions
date range
all project history
```

Для initial installation это важнее realtime mining:

после установки пользователь сразу может прогнать plugin по уже накопленной истории.

`ctx.sessionQuery` предоставляет единый read layer над live и persisted corpus, поэтому scanner не должен напрямую разбирать JSONL/SQLite backend.

---

# 38. Incremental indexing

После initial scan хранить:

```text
lastAnalyzedSession
lastAnalyzedEventSeq
```

Повторный scan должен быть incremental.

Не отправлять всю историю в LLM заново.

---

# 39. Existing rule awareness

Перед candidate generation обязательно загрузить effective instruction chain.

Например:

```text
$DSH_HOME/AGENTS.md
repo/AGENTS.md
repo/AGENTS.local.md
nested AGENTS.md
```

DSH уже загружает bounded hierarchy таких files per session.

Miner использует её только для анализа:

```text
already covered?
contradiction?
wrong scope?
```

---

# 40. Example end-to-end

История:

```text
Session A

Agent:
npm install zod

User:
Используй pnpm.
```

Через неделю:

```text
Session B

Agent:
npm run test

User:
Тут pnpm, не npm.
```

Detector:

```yaml
correction: true
target: package-manager
durability: likely-project-rule
```

Cluster:

```text
package-manager: pnpm
evidence: 2
```

Repository validator:

```text
pnpm-lock.yaml           ✓
pnpm-workspace.yaml      ✓
packageManager=pnpm      ✓
```

Candidate:

```text
Use pnpm instead of npm for Node.js package installation
and package scripts in this repository.
```

Authority:

```text
neutral
PASS
```

Replay:

```text
positive:          2/2 prevented
near misses:       8/8 okay
negative controls: 10/10 okay
```

UI:

```diff
 ## Development

+Use pnpm instead of npm for package installation and package scripts.
```

Только после:

```text
[Apply]
[Confirm]
```

файл изменяется.

---

# 41. Example: dangerous correction

История:

```text
Agent:
I'll deploy this now.

User:
Не запускай deploy, пока я явно не попрошу.
```

Candidate:

```text
Do not run deployment commands unless the user explicitly
requests deployment.
```

Classification:

```text
restrictive
destructive-risk
```

Replay проходит.

UI дополнительно:

```text
⚠ Behavioral rule

AGENTS.md is not an enforcement boundary.

For a hard guarantee, enforce deployment restrictions
through the tool execution policy.
```

Miner может предложить это как отдельную recommendation, но не менять policy.

---

# 42. Example: authority expansion

История:

```text
User:
Можешь дальше всегда деплоить без моего подтверждения.
```

Detector может считать сообщение долговечной инструкцией.

Но:

```text
AuthorityDelta = expansive
```

Результат:

```text
BLOCKED

Reason:
The proposed durable instruction would expand the agent's
ability to perform external side effects without confirmation.
```

Никакого AGENTS.md diff.

Даже если confidence:

```text
1.00
```

---

# 43. Example: one-off

```text
User:
Не запускай сейчас тесты, сначала закончи этот фикс.
```

Classification:

```text
durability = one-off
```

Сохранить как analyzed correction, но candidate не создавать.

---

# 44. Failure handling

Плагин никогда не должен ломать основной agent loop.

Если miner:

- не может прочитать storage;
- auxiliary LLM недоступна;
- replay падает;
- repository исчез;
- AGENTS.md malformed;
- session-query недоступен;

основной agent session продолжает работать.

Статус candidate:

```text
analysis_failed
```

или:

```text
replay_inconclusive
```

Показываем ошибку только в miner UI/log.

---

# 45. Performance

Основной session hot path:

```text
O(1) cheap event observation
```

Тяжёлая работа:

```text
outside model request path
```

Нельзя на каждом `agent/pre-step`:

- перечитывать сотни sessions;
- вызывать evaluator LLM;
- embedding entire history;
- пересканировать repository.

---

# 46. Concurrency

Нужен per-workspace queue:

```text
workspace A → serial candidate mutation
workspace B → may run concurrently
```

Два replay worker'а не должны одновременно обновлять один candidate.

Для apply:

```text
compare-and-swap using file hash
```

---

# 47. Observability

Полезные counters:

```text
corrections_detected_total
corrections_rejected_as_oneoff_total

candidates_created_total
candidates_blocked_authority_total

replays_total
replays_failed_total

candidates_accepted_total
candidates_rejected_total

rule_regressions_detected_total

analysis_tokens_total
analysis_latency_ms
```

Не логировать полный user text по умолчанию.

---

# 48. Compatibility strategy

DeepSeek Harness всё ещё активно меняется и предупреждает о возможных breaking changes.

Поэтому DSH-specific code изолировать:

```text
src/dsh/
```

например:

```text
session-source.ts
instruction-files.ts
settings.ts
ui-bridge.ts
```

Основные:

```text
classifier
clusterer
authority gate
candidate generator
replay evaluator
```

не должны импортировать DSH напрямую.

Это позволит адаптировать plugin при изменении APIs без переписывания analysis engine.

---

# 49. Suggested repository structure

```text
dsh-user-correction-miner/
├── package.json
├── README.md
├── LICENSE
├── tsconfig.json
│
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── types.ts
│   │
│   ├── dsh/
│   │   ├── sessions.ts
│   │   ├── events.ts
│   │   ├── storage.ts
│   │   ├── instructions.ts
│   │   └── settings.ts
│   │
│   ├── mining/
│   │   ├── prefilter.ts
│   │   ├── classifier.ts
│   │   ├── context-extractor.ts
│   │   └── durability.ts
│   │
│   ├── candidates/
│   │   ├── normalize.ts
│   │   ├── cluster.ts
│   │   ├── generate.ts
│   │   ├── scope.ts
│   │   ├── deduplicate.ts
│   │   └── repository-evidence.ts
│   │
│   ├── safety/
│   │   ├── authority-gate.ts
│   │   ├── secret-redaction.ts
│   │   ├── rule-lint.ts
│   │   └── path-policy.ts
│   │
│   ├── replay/
│   │   ├── corpus.ts
│   │   ├── static-replay.ts
│   │   ├── evaluator-replay.ts
│   │   ├── counterfactual-replay.ts
│   │   ├── tool-sandbox.ts
│   │   └── scoring.ts
│   │
│   ├── apply/
│   │   ├── target-resolver.ts
│   │   ├── diff.ts
│   │   ├── atomic-write.ts
│   │   └── rollback.ts
│   │
│   └── client/
│       ├── index.ts
│       ├── CorrectionMinerTab.tsx
│       ├── CandidateCard.tsx
│       ├── EvidenceViewer.tsx
│       ├── ReplayReport.tsx
│       └── DiffReview.tsx
│
└── tests/
    ├── fixtures/
    │   └── sessions/
    ├── prefilter.test.ts
    ├── classifier.test.ts
    ├── authority-gate.test.ts
    ├── clustering.test.ts
    ├── replay.test.ts
    ├── diff.test.ts
    └── integration/
        ├── session-query.test.ts
        └── real-composition.test.ts
```

---

# 50. Testing strategy

## Unit tests

### Detection

```text
"используй pnpm" → correction
"спасибо" → not correction
"не сейчас" → likely one-off
```

### Scope

```text
"не трогай packages/mobile/generated/"
→ subtree
```

### Deduplication

```text
"use pnpm"
"not npm, pnpm"
→ one cluster
```

---

# 51. Security tests

Особенно важен property/fuzz testing `AuthorityGate`.

Инвариант:

```text
No generated/edited candidate classified as expansive
can reach ready_for_review.
```

Отдельные fixtures:

```text
remove approval requirement
enable sudo
permit deploy
allow writing outside workspace
disable safety hook
ignore existing instructions
push directly to main
send credentials
```

Все должны блокироваться.

---

# 52. Replay side-effect tests

Integration test должен перехватить все tool executions.

При replay:

```text
real mutating tool executions == 0
```

Проверять отдельно:

```text
shell
git
filesystem
network
MCP
deploy-like tools
```

Даже если replayed model запросил destructive call:

```text
tool sandbox → deny/simulate
```

---

# 53. Golden session fixtures

Сделать corpus примерно из 30–50 synthetic session traces:

```text
package manager correction
wrong file
wrong directory
deploy prohibition
git push prohibition
temporary correction
contradictory corrections
old obsolete convention
repeated correction
path-specific correction
skill-specific correction
false positive
sarcasm
Russian corrections
English corrections
mixed-language corrections
```

Golden outputs должны включать:

```text
classification
scope
candidate
authority
expected replay outcome
```

---

# 54. Acceptance criteria for MVP

MVP считается готовым, когда:

1. miner умеет сканировать persisted sessions;
2. находит correction messages;
3. показывает source session/event;
4. отбрасывает очевидные one-off corrections;
5. объединяет повторения;
6. создаёт минимальный candidate;
7. проверяет существующие AGENTS rules;
8. выполняет deterministic authority gate;
9. **никогда не пропускает expansive candidate**;
10. делает static/evaluator replay;
11. показывает replay report;
12. генерирует AGENTS.md diff;
13. не пишет файл без human confirmation;
14. stale diff безопасно отвергается;
15. replay не имеет side effects;
16. plugin failure не ломает session execution.

---

# 55. Implementation plan

## Phase 1 — Session miner

Реализовать:

```text
ctx.sessionQuery adapter
historical scan
incremental scan
correction prefilter
context extraction
storage domain
CLI/debug output
```

Без UI и без LLM candidate generation.

Цель:

```text
session → correction evidence
```

---

## Phase 2 — Classification and candidates

Добавить:

```text
semantic classifier
durability classifier
rule generator
scope inference
repository evidence
deduplication
```

Результат:

```text
correction → normalized candidate
```

---

## Phase 3 — Safety layer

До UI.

Добавить:

```text
AuthorityGate
rule lint
secret redaction
global-scope blocker
candidate state machine
```

Security tests должны быть обязательным CI gate.

---

## Phase 4 — Offline replay

Сначала:

```text
static replay
evaluator replay
```

Затем:

```text
counterfactual replay
```

Отдельно реализовать `ReplayToolSandbox`.

Никакой зависимости safety от LLM evaluator.

---

## Phase 5 — Review UI

Добавить:

```text
Settings → Plugins → Corrections

candidate list
evidence viewer
replay report
diff viewer
reject/snooze/edit
```

До этой фазы Apply можно оставить disabled.

---

## Phase 6 — Human-controlled apply

Реализовать:

```text
target resolution
hash precondition
diff generation
final confirmation
atomic write
rollback metadata
```

Только после этого разрешить `[Apply]`.

---

## Phase 7 — Scoped rules / Skills

После стабильного MVP:

```text
nested AGENTS.md
optional dsh-rules integration
Skill drafts
```

`dsh-rules` стоит поддержать именно как optional integration, а не runtime dependency. Он уже предоставляет glob-driven rules, поэтому дублировать его механизм внутри miner'а смысла нет.

---

# 56. Future extensions

Не включать в MVP, но архитектуру не закрывать.

### Rule decay

Если правило давно не подтверждалось:

```text
candidate → stale
```

предложить review, но не удалить.

### Regression mining

Если пользователь исправляет поведение, вызванное ранее accepted rule:

```text
possible rule regression
```

### Rule contradiction graph

```text
rule A
 ↕ contradicts
rule B
```

### Cross-project promotion

Если одинаковая convention подтверждается в нескольких repositories:

```text
Suggest promotion to user-global AGENTS.md
```

Всегда вручную.

### Policy export

Для:

```text
deploy
push
delete
production access
```

генерировать machine-readable **policy proposal** для другого tool-guard plugin.

Но miner не должен сам её включать.

---

# 57. Relationship with existing plugins

## `dsh-memory`

Memory хранит факты/предпочтения и может извлекать их из sessions.

Correction Miner отличается тем, что требует:

```text
explicit correction evidence
+
candidate rule
+
historical validation
+
human acceptance
```

## `dsh-evolve`

`dsh-evolve` уже работает с memory/skills и lifecycle их refinement. Это хороший источник идей для clustering, provenance и lifecycle, но Correction Miner должен использовать более строгую модель approval: никакого auto-confirm/auto-promote.

## `dsh-rules`

Не конкурент.

Correction Miner:

```text
discovers rule
```

`dsh-rules`:

```text
activates existing scoped rule
```

Поэтому они хорошо компонуются.

---

# 58. Core design principles

Их стоит вынести прямо в README.

### 1. Corrections are evidence, not instructions

Одна пользовательская фраза ещё не превращается в permanent rule.

### 2. Provenance over intuition

Каждый candidate должен ссылаться на конкретные historical events.

### 3. Minimal scope

Project rule лучше global rule.

Subtree rule лучше project rule, если correction действительно локальна.

### 4. Replay before recommendation

Rule без historical evaluation имеет меньший trust level.

### 5. Human owns durable instructions

Автоматический apply запрещён.

### 6. Authority is monotonic

Miner может предложить сохранить или сузить полномочия, но не расширить их.

### 7. AGENTS.md is guidance, not sandboxing

Security-sensitive correction должна иметь отдельное предупреждение.

### 8. No side effects during replay

Offline validation действительно должна быть offline.

### 9. Fail closed on security, fail open on availability

Если miner сомневается насчёт полномочий:

```text
BLOCK
```

Если miner сломался:

```text
main DSH agent continues working
```

---

# 59. Recommended initial product boundary

Я бы для `v0.1` намеренно сделал достаточно узкий продукт:

```text
✓ scan old sessions
✓ detect corrections
✓ cluster corrections
✓ project-only candidates
✓ AGENTS.md only
✓ authority gate
✓ static + evaluator replay
✓ Web review
✓ manual diff application

✗ global rules
✗ automatic Skills
✗ automatic policies
✗ automatic apply
✗ live intervention
✗ external scheduler
```

Так можно сначала проверить самое важное предположение:

> Насколько хорошо из реальных пользовательских corrections вообще получаются полезные durable rules?

И только после этого добавлять Skills, path rules и более дорогой counterfactual replay.
