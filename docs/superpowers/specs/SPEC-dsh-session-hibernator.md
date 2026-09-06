# SPEC: `dsh-session-hibernator`

## 1. Summary

`dsh-session-hibernator` — plugin для DeepSeek Harness, автоматически освобождающий process-local ресурсы неактивных сессий.

После configurable периода бездействия plugin:

1. убеждается, что Agent действительно quiescent и может быть безопасно выгружен;
2. ставит lifecycle admission barrier, чтобы новое сообщение не попало в уничтожаемый runtime;
3. принудительно сохраняет durable Session log;
4. сохраняет актуальные session projections;
5. вызывает `AgentHandle.dispose()`;
6. тем самым уничтожает:
   - Agent loop;
   - `AgentHandle`;
   - live `Session`;
   - agent-scoped Cordis world;
   - plugin-local scoped services/listeners;
   - связанные process-local projections/caches;
7. оставляет только durable Session + projection checkpoint + маленькую hibernation metadata запись;
8. при следующем сообщении atomically выполняет cold resume через `ctx.agents.resume()`;
9. доставляет сообщение уже в новый residency epoch того же `SessionId`.

Главная цель:

> количество исторических сессий не должно линейно увеличивать heap usage процесса DSH.

Это соответствует общей архитектуре проекта: durable state должен жить отдельно от runtime, а изменения DSH предпочтительно реализовывать через plugin/capability seam, а не постоянный patch core.

---

# 2. Motivation

Сейчас Agent в DSH существенно тяжелее самой durable Session.

Upstream уже измерял стоимость live Agent после появления per-session presets:

- примерно `~0.17 MB` для minimal composition;
- примерно `~1.31 MB` на Agent для standard/cordis;
- рост линейный;
- после `AgentHandle.dispose()` память практически полностью возвращается;
- 50 standard Agents удерживали около `57.8 MB`, которые освобождались после disposal.

Проблема, следовательно, не обязательно является memory leak:

> object graph умеет нормально уничтожаться, но исторические Agent runtimes слишком долго остаются live.

При сотнях/тысячах открывавшихся сессий это превращается в существенную постоянную нагрузку на heap.

---

# 3. Existing DSH primitives

Плагин не должен создавать собственную альтернативную систему persistence.

DSH уже предоставляет почти все необходимые primitives.

## 3.1 Durable Session

`Session` является append-only event log и source of truth.

LLM history выводится из Session log, а не хранится отдельной независимой структурой.

## 3.2 Session persistence

Через `ctx.sessionPersistence` существуют JSONL/SQLite backends.

`ctx.sessions.flush(session)` является explicit durability/quiescence barrier: persistence backend должен дождаться записи уже принятых событий.

## 3.3 Projection cache

`ctx.sessionProjectionCache` уже умеет durable checkpoint log-derived projections.

Особенно удобно, что API предоставляет:

```ts
await ctx.sessionProjectionCache.write(session)
```

а cache автоматически пишет mandatory checkpoints на:

- `turn/end`;
- session disposal.

`write(session)` сначала обеспечивает durable log boundary и затем сохраняет projection cut.

## 3.4 Agent resume

DSH уже умеет:

```ts
ctx.agents.resume({
  resumeSessionId,
  agentOptions,
  setup,
})
```

Resume загружает persisted Session, восстанавливает history и создаёт новый scoped Agent runtime под тем же `SessionId`.

## 3.5 Agent disposal

`AgentHandle`:

```ts
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`dispose()`:

- останавливает loop;
- ждёт его завершения;
- unregister'ит Agent;
- удаляет live Session из store;
- unwinds scoped world.

Именно это является основной memory-release primitive.

---

# 4. Critical architectural constraint

Это самый важный момент SPEC.

## `ctx.agents.get(id)` недостаточно

Registry возвращает:

```ts
Agent
```

но не:

```ts
AgentHandle
```

Это сделано специально.

Правом полного teardown обладает owner `AgentHandle`, а произвольный observer не должен иметь возможность уничтожить чужой Agent.

При этом current `dsh-host-apiproxy` создаёт AgentHandle, но не сохраняет его для последующего idle eviction.

Upstream прямо описывает текущее состояние:

> `dsh-host-apiproxy` discards the `AgentHandle` it creates

и указывает, что idle eviction должен реализовываться на стороне host, владеющей handle.

Поэтому реализация вида:

```ts
ctx.on('agent/status', ...)
setTimeout(...)
ctx.agents.get(id)?.dispose()
```

невозможна и концептуально неправильна.

---

# 5. Architectural decision

## Recommended architecture

`dsh-session-hibernator` должен вводить небольшой **Agent Residency Manager**.

Не Session persistence manager.

Не вторую Session implementation.

Именно manager residency epochs.

У одной durable Session:

```text
Durable Session
      │
      ├── HIBERNATED
      │      no live Agent
      │
      │ next message
      ▼
 residency epoch #17
      │
      ├── AgentHandle
      ├── Agent
      ├── live Session
      ├── scoped Cordis world
      └── projections
      │
      │ idle timeout
      ▼
 Durable Session
```

Это очень похоже на уже существующую в DSH концепцию continuable subagent Activation:

```text
persisted Session
  -> optional live Activation
       -> AgentHandle
       -> Agent
```

Continuation manager уже решает cold resume, disposal races и residency epochs, поэтому его lifecycle-подход стоит использовать как референс.

---

# 6. Required small DSH integration seam

Для корректной реализации потребуется небольшой integration patch/seam в Host.

Это следует считать prerequisite, а не грязным workaround.

## Preferred variant

Host перестаёт просто выбрасывать `AgentHandle`.

Вместо:

```ts
const { agent } = await ctx.agents.resume(...)
return agent
```

условно:

```ts
const handle = await ctx.agents.resume(...)

return ctx.agentResidency.adopt(handle, {
  source: 'host',
})
```

После этого lifecycle принадлежит Residency Manager.

### Service

Условное имя:

```ts
ctx.agentResidency
```

или внутренне:

```ts
ctx.sessionHibernator
```

Предпочтительно первое — seam описывает общий lifecycle, а hibernation является policy поверх него.

---

# 7. Residency Manager contract

Пример conceptual API:

```ts
interface AgentResidencyManager {
  adopt(
    handle: AgentHandle,
    descriptor: ResidencyDescriptor,
  ): ResidentAgent

  acquire(
    sessionId: SessionId,
    request: ResumeRequest,
  ): Promise<ResidentAgentLease>

  hibernate(
    sessionId: SessionId,
    reason?: HibernateReason,
  ): Promise<HibernateResult>

  state(
    sessionId: SessionId,
  ): ResidencyState | undefined
}
```

Где:

```ts
interface ResidentAgent {
  sessionId: SessionId
  agent: Agent
  epoch: number
}

interface ResidentAgentLease {
  agent: Agent
  epoch: number
  release(): void
}
```

Lease необязательно должен попасть в публичный API v1, но concept полезен:

> Agent нельзя начинать уничтожать, пока Host выполняет admission операции над этим exact residency epoch.

---

# 8. State machine

Не рекомендуется моделировать всё через несколько boolean.

Использовать явное состояние.

```text
                    activity
          ┌────────────────────────┐
          │                        │
          ▼                        │
     LIVE_RUNNING ───────────► LIVE_IDLE
                                 │
                                 │ idleTimeout
                                 ▼
                         HIBERNATE_PENDING
                                 │
                       eligibility recheck
                                 │
                                 ▼
                           HIBERNATING
                            │         │
                  success   │         │ failure
                            ▼         ▼
                       HIBERNATED   LIVE_IDLE
                            │
                         request
                            │
                            ▼
                         RESUMING
                         │      │
                 success │      │ failure
                         ▼      ▼
                   LIVE_RUNNING ERROR
```

Реальное persisted состояние не обязано хранить каждый transient state.

---

# 9. Residency epoch

Каждый materialization получает monotonically increasing `epoch`.

Например:

```ts
interface ResidencyEntry {
  sessionId: SessionId
  epoch: number
  handle: AgentHandle
  agent: Agent

  state:
    | 'running'
    | 'idle'
    | 'hibernating'
    | 'disposing'

  lastActivityAt: number

  disposal?: Promise<void>
  activeLeases: number
}
```

Зачем нужен `epoch`:

```text
Session A
Agent epoch #3
      │
      └── disposing

Session A
Agent epoch #4
      │
      └── resumed
```

Старый timeout или stale disposer от epoch #3 никогда не должен иметь возможность удалить epoch #4.

Любая async continuation должна проверять:

```ts
currentEntry === capturedEntry
```

либо:

```ts
currentEpoch === capturedEpoch
```

---

# 10. Idle definition

`idleTimeout` отсчитывается не просто от последнего `session/event`.

Сессия является кандидатом только когда одновременно выполнено несколько условий.

## Minimum eligibility

```text
agent.status === 'idle'
AND no active admission
AND no pending waking inbox work
AND no hibernation exclusion
AND persistence available
AND session is not already disposing
AND idleFor >= configured timeout
```

DSH определяет `idle` как отсутствие запланированного или активного driver work.

Но одной проверки `status === idle` недостаточно из-за concurrency windows.

---

# 11. Activity tracking

Обновлять `lastActivityAt` при:

- `agent/status -> running`;
- принятии нового user message;
- inbox insert;
- wakeup;
- resume;
- session creation;
- manual keepalive.

После перехода:

```text
running -> idle
```

можно ставить hibernation timer.

Не должны сбрасывать idle timeout:

- просмотр history;
- открытие session list;
- projection read;
- reconnect WebSocket;
- получение title;
- passive UI polling.

То есть **user viewing a conversation ≠ Agent activity**.

---

# 12. Hibernation algorithm

Полная транзакция.

## Step 1 — candidate selection

Timer находит:

```text
LIVE_IDLE
+
idleFor >= idleTimeout
```

Timer не должен непосредственно уничтожать Agent.

Он вызывает:

```ts
hibernate(sessionId, 'idle-timeout')
```

---

## Step 2 — per-session lifecycle lock

Все операции для одного `SessionId` должны linearize'иться.

Например:

```ts
locks.run(sessionId, ...)
```

Не нужен global mutex.

Параллельные сессии могут hibernate/resume независимо.

---

## Step 3 — establish admission cutoff

До первого `await`:

```ts
entry.disposal = disposalPromise
entry.state = 'hibernating'
```

Это принципиально важно.

После появления disposal marker никакой новый request не должен быть направлен в этот Agent.

Именно такой подход уже используется continuable subagent manager:

> presence of disposal transaction является admission cutoff; racing delivery ждёт disposal и затем cold-resume'ит новый Activation.

---

## Step 4 — eligibility recheck

Под lock проверить повторно:

```text
same residency epoch
agent.status === idle
no newly admitted message
no active lease
no exclusion
```

Если условие изменилось:

```text
abort hibernation
clear cutoff
return NOT_IDLE
```

---

# 13. Persistence barrier

Перед уничтожением live tree:

```ts
await ctx.sessions.flush(agent.session)
```

Ошибка persistence в default strict mode:

```text
HIBERNATE ABORTED
```

Agent остаётся live.

Почему:

если durable log не подтверждён, уничтожать единственную актуальную live state опасно.

---

# 14. Projection checkpoint

Если доступен:

```ts
ctx.sessionProjectionCache
```

выполнять:

```ts
await ctx.sessionProjectionCache.write(agent.session)
```

Это лучше, чем самостоятельно сериализовать projections.

Projection cache уже поддерживает именно live-to-cold transition и умеет восстанавливать values через:

```text
cached rows
    +
persistence tail
    +
projection replay
```



## Failure policy

Durable Session log:

```text
STRICT
```

Projection cache:

```text
BEST EFFORT
```

Если projection write упал:

```text
warn
continue disposal
```

Потому что projection является derived cache, а authority остаётся Session log.

При следующем cold read projection может быть восстановлена повторным fold.

---

# 15. Agent disposal

После checkpoint:

```ts
await entry.handle.dispose()
```

Это и есть настоящее освобождение heap.

После completion ожидается отсутствие:

```ts
ctx.agents.get(sessionId)
ctx.sessions.get(sessionId)
```

для данного residency epoch.

Durable persistence при этом остаётся.

---

# 16. Hibernation metadata

Не нужно сохранять full object snapshot.

Достаточно маленького sidecar.

Например:

```ts
interface HibernationRecord {
  version: 1

  sessionId: SessionId

  lastEpoch: number

  lastActivityAt: number
  hibernatedAt: number

  reason:
    | 'idle-timeout'
    | 'memory-pressure'
    | 'manual'
    | 'shutdown'

  lastKnownSeq: number
}
```

Можно хранить через `storageDomain`.

Sidecar нужен для:

- UI;
- diagnostics;
- metrics;
- debugging;
- future memory-pressure policy.

Он **не является authority для восстановления conversation**.

Authority:

```text
SessionPersistence
```

---

# 17. Cold resume

Новое сообщение в hibernated session не должно сначала вручную «разбудить» сессию через отдельный RPC.

Обычный:

```text
session.prompt
```

должен автоматически материализовать Agent.

Flow:

```text
incoming prompt
      │
      ▼
agentResidency.acquire(sessionId)
      │
      ├─ resident ──────► use live Agent
      │
      ├─ hibernating ───► await disposal
      │                      │
      │                      ▼
      │                   resume
      │
      └─ hibernated ─────► resume
                             │
                             ▼
                     ctx.agents.resume(...)
                             │
                             ▼
                     new AgentHandle
                             │
                             ▼
                     register epoch N+1
                             │
                             ▼
                     admit original prompt
```

DSH Host уже имеет cold-session resume behavior для своих session operations, поэтому задача в основном состоит в том, чтобы встроить residency lifecycle в существующий lookup path, а не создавать ещё один message protocol.

---

# 18. Resume deduplication

Если одновременно пришли:

```text
prompt A
prompt B
command C
```

к hibernated session, они не должны вызвать три:

```ts
ctx.agents.resume()
```

Использовать single-flight:

```ts
entry.resumePromise
```

или per-session lock.

Все requesters:

```text
await same resumePromise
```

После resume каждый продолжает admission в уже опубликованный Agent.

---

# 19. Most important race: message vs hibernate

Нельзя реализовывать так:

```text
1. timer checks idle
2. await flush
3. dispose
```

потому что между `1` и `3` может прийти prompt.

Плохой сценарий:

```text
Timer                User request

idle
 |
flush()
 |                  ctx.agents.get(id)
 |                  -> old Agent
 |
dispose()
 |
                  followup(old Agent)
```

Результат потенциально:

- rejected delivery;
- message admitted into dying runtime;
- lost wakeup;
- undefined lifecycle behavior.

Правильный вариант:

```text
Timer                   User request

set disposal cutoff
 |
flush
 |                      acquire(id)
 |                      sees disposal
 |                      awaits disposal
dispose
 |
HIBERNATED
                        resume()
                        deliver
```

Это **обязательное acceptance criterion**.

---

# 20. Resume vs resume race

Также:

```text
Request A       Request B

cold
resume()
                cold
                resume()
```

должен давать:

```text
ONE ctx.agents.resume()
ONE AgentHandle
ONE agent/created lifecycle
```

---

# 21. Timer vs stale residency race

Старый timer:

```text
epoch 12 idle timer
```

может fire после:

```text
epoch 12 disposed
epoch 13 resumed
```

Поэтому timer всегда захватывает:

```ts
const epoch = entry.epoch
```

и перед действием проверяет exact identity.

---

# 22. Scope v1

Для первой версии я бы намеренно ограничил scope.

## Include

- top-level Web sessions;
- agents, materialized через Host/API proxy;
- JSONL persistence;
- SQLite persistence;
- standard Cordis agent presets;
- automatic resume on prompt/command.

## Initially exclude

### Config-created always-on Agents

Например service/daemon-style Agent, который задан непосредственно в `agent-loop` config.

У него другой structural owner, и AgentLoop может сам discard'ить handle.

### One-shot subagents

Их lifecycle уже явно управляется subagent runtime.

### Continuable subagents

У них уже есть собственная концепция Activation и cold resume.

Дублировать поверх неё второй eviction manager не стоит.

В будущем эти lifecycle managers можно унифицировать.

---

# 23. Sessions with children

В v1:

```text
has live owned child => NOT HIBERNATABLE
```

Лучше потерять часть экономии heap, чем преждевременно разрушить ownership tree.

Продвинутый вариант потом:

```text
hibernate tree child-first
```

Именно child-first teardown уже используется для continuable Activations.

---

# 24. Pending jobs

Сессия не должна hibernate, если Agent владеет job, жизненный цикл которого требует live owner.

Default:

```text
owned live jobs > 0 => blocked
```

Позже можно добавить классификацию:

```text
job.hibernationSafe
```

---

# 25. Running tools / approval / Ask User

Как правило, они удерживают:

```text
agent.status === running
```

и автоматически блокируют hibernation.

Но integration tests должны отдельно проверить:

- tool execution;
- tool awaiting approval;
- ask-user;
- LLM streaming;
- cancellation;
- retry/backoff.

---

# 26. Configuration

Предлагаемый config:

```yaml
- id: session-hibernator
  name: dsh-session-hibernator
  config:
    enabled: true

    idleTimeoutMs: 900000

    scanIntervalMs: 60000

    minResidentMs: 60000

    persistence:
      require: true
      flushBeforeHibernate: true

    projections:
      checkpoint: true
      failureMode: warn

    concurrency:
      maxParallelHibernations: 4
      maxParallelResumes: 8

    exclusions:
      configuredAgents: true
      continuableSubagents: true
      sessionsWithLiveChildren: true
      sessionsWithOwnedJobs: true

    logging:
      lifecycle: true

    metrics:
      enabled: true
```

---

# 27. Recommended defaults

```text
idleTimeoutMs          15 min
scanIntervalMs          1 min
minResidentMs           1 min
maxParallelHibernations 4
maxParallelResumes      8
```

`minResidentMs` нужен против thrashing:

```text
resume
30 sec
hibernate
5 sec
resume
...
```

После resume Agent минимум некоторое время остаётся resident.

---

# 28. Optional memory-pressure mode

Не включать в MVP, но архитектуру предусмотреть.

В будущем:

```yaml
policy:
  mode: idle-and-pressure

memoryPressure:
  heapUsedPercent: 75
  targetHeapUsedPercent: 60
```

Algorithm:

```text
heap > threshold
       │
       ▼
sort eligible resident sessions:
  1. oldest idle
  2. largest estimated residency
       │
       ▼
hibernate until target reached
```

Можно добавить:

```text
manual
idle
memory-pressure
LRU
maxResidentSessions
```

под одним engine.

---

# 29. Alternative policy: maxResidentSessions

Очень полезное расширение:

```yaml
maxResidentSessions: 50
```

После materialization session #51:

```text
evict least recently active eligible resident
```

Это даёт hard-ish bound на runtime population независимо от количества исторических sessions.

---

# 30. UI behavior

Хибернация не должна восприниматься пользователем как archive/close.

В session list можно показывать маленький status:

```text
● Active
○ Sleeping
↻ Resuming
```

Но UI не является MVP blocker.

### Important

Hibernation:

```text
!= archive
!= close
!= delete
!= unload workspace
```

Это исключительно process residency state.

---

# 31. Manual controls

Полезно добавить commands:

```text
/hibernate
```

Hibernate current session после окончания текущего turn.

И diagnostic host commands:

```text
/hibernate-status
```

Но желательно не загрязнять model-facing tool catalog.

Лучше host-side command или settings UI.

---

# 32. Observability

Плагин очень желательно сразу сделать OTel-friendly.

Metrics:

```text
dsh_hibernator_resident_sessions
dsh_hibernator_hibernated_sessions_total
dsh_hibernator_resumes_total
dsh_hibernator_hibernate_failures_total
dsh_hibernator_resume_failures_total

dsh_hibernator_hibernate_duration_ms
dsh_hibernator_resume_duration_ms

dsh_hibernator_checkpoint_duration_ms

dsh_hibernator_blocked_total{reason}

dsh_hibernator_residency_age_ms
dsh_hibernator_idle_age_ms
```

Особенно интересна метрика:

```text
resident_sessions
```

рядом с:

```text
process_heap_used_bytes
```

Так будет хорошо видно реальный эффект.

---

# 33. Structured logs

Lifecycle logs:

```text
[session-hibernator] candidate
  session=...
  idle=932s
  epoch=4

[session-hibernator] hibernating
  session=...
  seq=391

[session-hibernator] hibernated
  session=...
  epoch=4
  duration=84ms

[session-hibernator] resuming
  session=...
  epoch=5

[session-hibernator] resumed
  session=...
  duration=126ms
```

Не логировать content prompt/session.

---

# 34. Failure handling

## Persistence flush failed

```text
do not dispose
state -> LIVE_IDLE
retry after backoff
```

## Projection checkpoint failed

Default:

```text
warn
continue
```

## `handle.dispose()` failed

```text
state -> ERROR
do not immediately attempt resume
inspect ctx.agents.get(id)
```

Нужно различить:

- Agent действительно остался live;
- Agent исчез, но disposer завершился ошибкой;
- partial teardown.

Не создавать replacement до установления registry state.

## Resume failed

Original incoming request должен получить понятную ошибку.

Session остаётся:

```text
HIBERNATED
```

и следующий request может retry.

---

# 35. Backoff

Lifecycle failures не должны создавать tight retry loop.

Например:

```text
1s
5s
30s
2m
10m
```

с reset после успешной activity/resume.

---

# 36. Plugin unload

При unload `dsh-session-hibernator`:

1. прекратить новые hibernations;
2. отменить idle timers;
3. дождаться уже начатых lifecycle transactions;
4. **не уничтожать все resident Agents только потому, что plugin выключили**, если ownership может быть безопасно возвращён Host;
5. либо явно drain'ить собственные handles, если именно plugin является их structural lifecycle owner.

Ownership semantics здесь должны быть документированы особенно тщательно.

---

# 37. Host shutdown

Отдельный режим:

```text
reason = shutdown
```

Можно использовать уже существующий teardown Host.

Не нужно превращать shutdown в массовый hibernate flow, если Host и persistence backend и так гарантируют flush/dispose.

---

# 38. Repository structure

```text
dsh-session-hibernator/
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  │
│  ├─ residency/
│  │  ├─ service.ts
│  │  ├─ types.ts
│  │  ├─ manager.ts
│  │  ├─ entry.ts
│  │  └─ lock.ts
│  │
│  ├─ lifecycle/
│  │  ├─ activity.ts
│  │  ├─ eligibility.ts
│  │  ├─ hibernate.ts
│  │  ├─ resume.ts
│  │  └─ errors.ts
│  │
│  ├─ persistence/
│  │  └─ metadata.ts
│  │
│  ├─ policy/
│  │  ├─ idle.ts
│  │  └─ scheduler.ts
│  │
│  ├─ observability/
│  │  ├─ metrics.ts
│  │  └─ logging.ts
│  │
│  └─ host/
│     └─ integration.ts
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ races/
│  ├─ persistence/
│  └─ memory/
│
├─ package.json
├─ cordis.yml
├─ README.md
└─ SPEC.md
```

---

# 39. Host integration patch

Я бы держал DSH-specific integration максимально маленьким.

Например upstream seam:

```ts
interface AgentResidencyProvider {
  adopt(handle: AgentHandle): Agent
  acquire(sessionId: SessionId): Promise<Agent>
}
```

А API Proxy должен обращаться через provider вместо самостоятельного discard handles.

Если provider не установлен:

```text
current DSH behavior
```

Если установлен `dsh-session-hibernator`:

```text
managed residency
```

Это позволит избежать постоянного форка Host.

---

# 40. Compatibility strategy

DSH сейчас находится в developer preview и прямо предупреждает о возможных compatibility-breaking changes.

Поэтому:

- импортировать только public package APIs;
- минимизировать imports из `src/*`;
- host patch вынести в отдельный adapter;
- проверить DSH version/range при startup;
- fail closed, если ожидаемый lifecycle seam отсутствует;
- не пытаться monkey-patch private Agent objects.

Например:

```json
{
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": ">=x <y"
  }
}
```

---

# 41. Testing strategy

Это lifecycle plugin, поэтому обычных unit tests недостаточно.

## 41.1 Basic hibernate

```text
create session
send turn
wait idle
trigger timer

expect:
  agents.get(id) === undefined
  sessions.get(id) === undefined
  persistence contains session
```

---

## 41.2 Resume

```text
hibernate
send new prompt

expect:
  new Agent instance
  same SessionId
  previous conversation visible
  turn numbering continues
```

DSH resume уже должен сохранять turn/history semantics; plugin должен доказать, что не ломает их.

---

## 41.3 Projection continuity

Перед hibernate записать:

```text
title
todos
stats
other projections
```

После cold resume/listing:

```text
same logical values
```

---

## 41.4 Prompt vs hibernate race

Самый важный test.

Artificially блокировать:

```ts
sessions.flush()
```

Во время блокировки отправить prompt.

Ожидание:

```text
prompt never reaches disposing Agent

dispose completes

exactly one resume occurs

prompt delivered exactly once
```

---

## 41.5 Resume deduplication

100 concurrent requests в cold session.

Expect:

```text
ctx.agents.resume call count === 1
```

---

## 41.6 Stale timer

```text
epoch 1 timer
hibernate epoch 1
resume epoch 2
fire old timer
```

Expect:

```text
epoch 2 remains live
```

---

## 41.7 Persistence failure

Backend `flush()` rejects.

Expect:

```text
Agent remains live
no hibernated metadata committed
```

---

## 41.8 Projection failure

Projection write rejects.

Expect:

```text
Agent can still hibernate
Session log survives
projection reconstructed later
```

---

## 41.9 Tool execution

Start long tool call.

Expire idle scheduler.

Expect:

```text
no hibernation
```

---

## 41.10 Queued message

Agent becomes candidate, then inbox receives work.

Expect:

```text
hibernate aborted
message processed
```

---

## 41.11 Children

Agent with live continuable child.

Expect v1:

```text
blocked(reason=live-child)
```

---

# 42. Memory test

Обязательный benchmark.

Scenario:

```text
create 500 sessions
run one trivial turn each
allow all to become idle
force GC where test environment allows
```

Compare:

```text
baseline DSH:
500 resident Agents

hibernator:
~0 active Agents
500 persisted Sessions
```

Измерить:

```text
heapUsed
heapTotal
rss
external
resident agent count
```

После random resume 10 sessions:

```text
residentAgents ~= 10
```

Не фиксировать acceptance criterion в конкретных MB, потому что preset/plugin composition влияет на стоимость Agent.

Основной invariant:

```text
heap residency depends primarily on active sessions,
not historical session count.
```

---

# 43. Stress test

Random state machine fuzzing:

```text
prompt
followup
cancel
hibernate
resume
command
tool
archive
reconnect
hibernate
prompt
```

для нескольких сотен sessions параллельно.

Проверять:

```text
<= 1 live Agent per SessionId
<= 1 live Session per SessionId
<= 1 active resume transaction
no unpaired residency ownership
no stale handle disposal
no duplicate user message
```

---

# 44. Acceptance criteria

Plugin можно считать production-ready только если выполняются все пункты.

### Functional

- idle Agent автоматически исчезает из live Agent registry;
- live Session также освобождается;
- persisted conversation не изменяется;
- следующий prompt transparently cold-resume'ит session;
- SessionId остаётся прежним;
- conversation history сохраняется;
- projections корректно восстанавливаются.

### Concurrency

- message-vs-dispose race безопасен;
- resume deduplicated;
- stale timers безопасны;
- replacement Agent нельзя уничтожить старым disposer;
- максимум один residency epoch live одновременно.

### Durability

- failed transcript flush блокирует hibernation;
- projection failure не уничтожает authority;
- crash/restart использует обычный DSH persistence path.

### Memory

- heap не растёт линейно с количеством уже использованных, но давно idle top-level sessions;
- `AgentHandle.dispose()` действительно вызывается;
- scoped worlds исчезают.

---

# 45. Non-goals v1

Не включать:

- custom Session serialization;
- heap snapshots как механизм persistence;
- serialization arbitrary JS objects;
- restoration exact V8 object graph;
- сохранение active LLM stream;
- pausing running tool execution;
- process migration;
- remote distributed Agent relocation;
- continuable subagent lifecycle replacement;
- configured daemon Agent eviction;
- automatic storage deletion.

---

# 46. Implementation plan

## Phase 0 — lifecycle spike

Цель: доказать техническую осуществимость на текущем DSH.

Сделать маленький integration test:

```text
create Host session
obtain retained AgentHandle
flush
projectionCache.write
dispose
ctx.agents.resume
send prompt
```

Проверить сохранение:

- history;
- cwd;
- preset;
- provider/model selection;
- title/projections;
- SessionId.

---

## Phase 1 — AgentHandle ownership seam

Самый важный этап.

Изменить Host integration так, чтобы созданные/resumed handles не выбрасывались.

Добавить:

```text
AgentResidencyManager
```

который является единственной lifecycle authority для управляемых top-level Host Agents.

Без этого переходить к idle timers не стоит.

---

## Phase 2 — residency state machine

Реализовать:

- residency entries;
- epoch;
- per-session lock;
- single-flight resume;
- disposal cutoff;
- exact-entry checks.

Пока без автоматического timer.

Проверить вручную:

```ts
hibernate(id)
acquire(id)
```

---

## Phase 3 — durable hibernate

Добавить transaction:

```text
eligibility
→ session flush
→ projection checkpoint
→ handle.dispose
→ hibernated metadata
```

И failure recovery.

---

## Phase 4 — transparent cold resume

Перевести Host Agent lookup/admission на:

```ts
ctx.agentResidency.acquire()
```

Покрыть:

- prompt;
- commands, которым нужен Agent;
- другие Host RPC, которые должны materialize cold session.

Read-only operations не должны resume Agent без необходимости.

---

## Phase 5 — idle policy

Добавить:

- activity tracking;
- timeout;
- scheduler;
- min residency;
- exclusions.

После этого plugin уже решает исходную задачу.

---

## Phase 6 — races

Отдельно реализовать deterministic race tests:

1. prompt vs hibernate;
2. resume vs resume;
3. dispose vs plugin unload;
4. timer vs replacement epoch;
5. child activation vs parent hibernate;
6. persistence failure during cutoff.

Это не дополнительный polish — без этого lifecycle plugin нельзя считать безопасным.

---

## Phase 7 — observability

Добавить:

- metrics;
- structured lifecycle logs;
- status inspection;
- manual hibernate command.

---

## Phase 8 — memory-pressure policies

После стабильного MVP:

```text
maxResidentSessions
LRU
heap-pressure eviction
manual pin
per-workspace policies
```

---

# 47. Suggested milestone split

### `v0.1.0` — manual residency

```text
AgentHandle retention
manual hibernate
cold resume
race-safe lifecycle
```

### `v0.2.0` — idle hibernation

```text
idle timers
eligibility
projection checkpoints
metrics
```

### `v0.3.0` — policies

```text
maxResidentSessions
LRU
session pinning
workspace overrides
```

### `v0.4.0` — memory pressure

```text
heap-aware eviction
adaptive thresholds
Grafana/OTel dashboard
```

---

# 48. Future: session pinning

Полезная policy:

```yaml
pinnedSessions:
  - ...
```

или runtime API:

```ts
ctx.agentResidency.pin(sessionId)
```

Use cases:

- постоянно используемый main Agent;
- daemon session;
- expensive-to-compose workspace;
- session, которая должна мгновенно отвечать.

Также:

```yaml
workspaceOverrides:
  "/projects/main":
    idleTimeoutMs: 3600000

  "/projects/archive":
    idleTimeoutMs: 300000
```

---

# 49. Future: adaptive hibernation

Можно оценивать actual Agent cost:

```text
heap before materialization
heap after GC/materialization
```

и поддерживать approximate:

```ts
estimatedResidentBytes
```

Тогда memory-pressure eviction сможет выбирать не просто самый старый Agent, а лучший:

```text
score =
  idleAge
  × estimatedResidentBytes
  / resumeCost
```

Но это точно не MVP.

---

# 50. Naming

## `dsh-session-hibernator`

Плюсы:

- понятно пользователю;
- хорошо описывает UX;
- легко найти.

Минус:

- technically Session не исчезает, исчезает live Agent/runtime.

### Alternatives

`dsh-agent-hibernator`

Технически точнее, но звучит как механизм сна самого model agent.

`dsh-agent-residency`

Лучшее архитектурное название для underlying seam, но хуже как user-facing plugin.

`dsh-idle-agent-eviction`

Очень точно, но звучит как внутренний infrastructure package.

### Recommendation

Package:

```text
dsh-session-hibernator
```

Internal service:

```text
agentResidency
```

Internal vocabulary:

```text
resident
hibernating
hibernated
resuming
residency epoch
```

---

# 51. Main architectural principle

Самое важное правило реализации:

> **Не snapshot'ить live Agent tree. Уничтожать его.**

Нам не нужно пытаться сериализовать:

```text
Agent
AgentLoop
Cordis Context
tool registry
listeners
timers
AbortControllers
provider objects
plugin scopes
```

Это практически гарантированно превратит plugin в хрупкий reflection-based runtime serializer.

DSH уже построен правильнее:

```text
durable log
      +
durable projection checkpoints
      ↓
  cold resume
      ↓
fresh runtime object graph
```

Именно этим механизмом должен пользоваться `dsh-session-hibernator`.

---

# 52. Final recommended architecture

```text
                        ┌──────────────────────────┐
                        │      Web / Host RPC      │
                        └────────────┬─────────────┘
                                     │
                                     ▼
                         ┌──────────────────────┐
                         │ AgentResidencyManager│
                         └──────────┬───────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
          resident              disposing              cold
             │                      │                      │
             ▼                      ▼                      ▼
        live Agent            await cutoff       ctx.agents.resume()
             │                      │                      │
             │                      └──────────────►───────┘
             │
     idle timeout
             │
             ▼
       eligibility
             │
             ▼
     sessions.flush()
             │
             ▼
 projectionCache.write()
             │
             ▼
 AgentHandle.dispose()
             │
             ▼
       HIBERNATED
             │
             ├──────── durable Session log
             ├──────── projection checkpoint
             └──────── tiny metadata sidecar
```

По сути, plugin превращает top-level Host Agent в ту же концепцию, которая уже используется для continuable subagents:

> одна durable Session может иметь **ноль или один process-local residency epoch**.

Это выглядит наиболее естественным и наиболее совместимым с текущей архитектурой DSH решением.