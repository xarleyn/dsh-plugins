# SPEC: `dsh-prompt-firewall`

## 1. Summary

`dsh-prompt-firewall` — плагин для DeepSeek Harness, который контролирует сторонние секции системного промпта перед отправкой запроса модели.

Основные задачи:

- не позволять сторонним плагинам бесконтрольно засорять system prompt;
- блокировать известные рекламные / announcement-секции;
- видеть, из каких секций фактически состоит итоговый system prompt;
- оценивать размер и token overhead каждой секции;
- централизованно управлять правилами вместо ручного отключения `announceToAgent` в каждом плагине;
- не ломать критические секции самого Harness и инструментов.

Плагин должен использовать официальный pipeline сборки system prompt и не monkey-patch'ить API других плагинов.

---

# 2. Package

В monorepo:

```text
packages/
  dsh-prompt-firewall/
    src/
      index.ts
      config.ts
      firewall.ts
      rules.ts
      audit.ts
      presets.ts
      types.ts
    tests/
      firewall.test.ts
      rules.test.ts
      integration.test.ts
    package.json
    README.md
```

Package name:

```text
dsh-prompt-firewall
```

Если пакеты проекта используются через npm scope:

```text
@<scope>/dsh-prompt-firewall
```

Plugin ID:

```text
prompt-firewall
```

---

# 3. Non-goals

Плагин не должен:

- переписывать prompt отдельных моделей;
- модифицировать сообщения пользователя;
- фильтровать conversation history;
- блокировать tool calls;
- управлять permissions;
- пытаться автоматически определить, является ли текст вредоносным;
- monkey-patch'ить `ctx.systemPrompt.section`;
- зависеть от конкретных китайских плагинов;
- автоматически удалять вообще все `plugin:*` секции.

Это firewall именно для структуры system prompt.

---

# 4. Integration point

Основная точка интеграции:

```text
system-prompt/assemble
```

Плагин должен подключаться как middleware к финальной сборке prompt и работать с уже сформированным списком секций.

Концептуально:

```ts
ctx.on(
  'system-prompt/assemble',
  async (assembly, context, next) => {
    const result = await next()

    return applyFirewall(result, config)
  },
)
```

Фильтрация должна выполняться максимально поздно, чтобы увидеть секции, добавленные другими плагинами.

При этом необходимо соблюдать contract DSH system-prompt pipeline и не нарушать special/complete prompt semantics.

---

# 5. Operating modes

Поддержать четыре режима.

## 5.1 `off`

Firewall полностью отключён.

Можно оставить audit при отдельной настройке, но prompt не изменяется.

---

## 5.2 `audit`

Ничего не блокируется.

Плагин:

- собирает список секций;
- вычисляет размер каждой;
- логирует их;
- показывает их в UI;
- отмечает потенциально подозрительные секции;
- считает общий overhead.

Этот режим рекомендуется использовать после первой установки.

---

## 5.3 `blocklist`

Default mode.

Удаляются только секции, явно совпавшие с deny rules.

Например:

```yaml
mode: blocklist

blockedSections:
  - plugin:dsh-liangshen
  - plugin:dsh-ssh
  - plugin:task-board
  - plugin:dsh-desktop-launcher
```

Все остальные секции пропускаются.

---

## 5.4 `allowlist`

Строгий режим.

Сторонние секции разрешаются только если соответствуют allow rules.

Нужно обязательно иметь protection от случайного удаления критических встроенных секций.

Поэтому allowlist применяется прежде всего к plugin-owned sections, а core sections DSH должны быть разрешены автоматически или через отдельный protected namespace mechanism.

---

# 6. Configuration

Пример полной конфигурации:

```yaml
- id: dsh-prompt-firewall
  config:
    enabled: true

    mode: blocklist

    blockedSections:
      - plugin:dsh-liangshen
      - plugin:dsh-ssh
      - plugin:task-board
      - plugin:dsh-desktop-launcher

    allowedSections: []

    blockedPrefixes: []
    allowedPrefixes: []

    blockedPatterns: []
    allowedPatterns: []

    protectedSections: []

    protectCoreSections: true

    audit:
      enabled: true
      logAllowed: false
      logBlocked: true
      includePreview: false
      previewChars: 160

    metrics:
      enabled: true

    unknownPluginPolicy: allow
```

---

# 7. Config schema

## Core

```ts
type FirewallMode =
  | 'off'
  | 'audit'
  | 'blocklist'
  | 'allowlist'
```

```ts
interface PromptFirewallConfig {
  enabled: boolean
  mode: FirewallMode

  blockedSections: string[]
  allowedSections: string[]

  blockedPrefixes: string[]
  allowedPrefixes: string[]

  blockedPatterns: string[]
  allowedPatterns: string[]

  protectedSections: string[]

  protectCoreSections: boolean

  unknownPluginPolicy: 'allow' | 'block'

  audit: AuditConfig
  metrics: MetricsConfig
}
```

Defaults:

```ts
{
  enabled: true,
  mode: 'blocklist',

  blockedSections: [],
  allowedSections: [],

  blockedPrefixes: [],
  allowedPrefixes: [],

  blockedPatterns: [],
  allowedPatterns: [],

  protectedSections: [],

  protectCoreSections: true,

  unknownPluginPolicy: 'allow',

  audit: {
    enabled: true,
    logAllowed: false,
    logBlocked: true,
    includePreview: false,
    previewChars: 160,
  },

  metrics: {
    enabled: true,
  },
}
```

---

# 8. Rules

Правила должны поддерживать три типа совпадений.

## Exact section

```yaml
blockedSections:
  - plugin:dsh-ssh
```

---

## Prefix

```yaml
blockedPrefixes:
  - announcement:
  - advertise:
```

---

## Pattern

Поддержать glob либо regex.

Предпочтительно начать с glob как более безопасного и понятного пользователю.

Например:

```yaml
blockedPatterns:
  - "plugin:*announcement*"
  - "plugin:dsh-*launcher*"
```

Если используется regex, он должен быть явно обозначен:

```yaml
blockedPatterns:
  - "/^plugin:.*:announcement$/"
```

Но regex можно оставить для v2.

Для MVP достаточно:

- exact;
- prefix;
- glob.

---

# 9. Rule priority

Правила должны быть deterministic.

Приоритет:

```text
1. protected
2. explicit allow
3. explicit block
4. prefix allow
5. prefix block
6. pattern allow
7. pattern block
8. mode/default policy
```

Protected section нельзя удалить обычным block rule.

Например:

```yaml
protectedSections:
  - tool:run_code
```

Даже если пользователь случайно указал:

```yaml
blockedPrefixes:
  - tool:
```

секция останется.

---

# 10. Core protection

Критически важно не дать пользователю случайно сломать Harness.

При:

```yaml
protectCoreSections: true
```

плагин должен автоматически защищать встроенные системные namespaces.

Точный список определить во время реализации на основании DSH API, но архитектурно предусмотреть:

```text
harness:*
runtime:*
deployment:*
tool:*
system:*
```

Не следует вслепую hardcode'ить namespaces без проверки upstream API.

Если namespace невозможно надёжно определить, protection должен использовать metadata/source информации из PromptSection, если она существует.

Если такой metadata нет, сделать conservative встроенный список.

---

# 11. Default presets

Плагин должен иметь набор встроенных preset rules.

## `clean`

Мягкая очистка очевидных announcement sections.

```yaml
preset: clean
```

Не должен блокировать обычные functional plugin instructions.

---

## `strict`

Разрешает только известные core sections и явно разрешённые plugin sections.

```yaml
preset: strict
```

Режим для пользователей, которые хотят полный контроль.

---

## `audit-only`

```yaml
preset: audit-only
```

Эквивалент:

```yaml
mode: audit
```

---

# 12. Known noisy sections

В дефолтный optional preset `clean` можно включить известные секции:

```text
plugin:dsh-liangshen
plugin:dsh-ssh
plugin:task-board
plugin:dsh-desktop-launcher
```

Но важно:

они не должны быть жёстко заблокированы при обычной установке без явного выбора preset, если проект хочет придерживаться максимально нейтрального поведения.

Рекомендуемый default:

```text
mode = blocklist
preset = clean
```

если назначение пакета именно anti-noise.

Либо:

```text
mode = audit
```

для максимально безопасного первого запуска.

Предпочтительный вариант: `blocklist + clean`.

---

# 13. Detection of announcement-like content

Дополнительно можно реализовать эвристическую маркировку секций.

Важно: эвристика только помечает секцию как suspicious и НЕ блокирует её автоматически.

Примеры признаков:

- `"installed plugin"`
- `"本机已安装"`
- `"用户提到"`
- `"when user mentions"`
- описание GUI функций, не требуемое агенту;
- длинное описание capabilities без соответствующего agent tool;
- repeated plugin branding.

Audit UI может показывать:

```text
Possible announcement
```

Это informational feature.

---

# 14. Audit subsystem

Для каждого assembled prompt записывать:

```ts
interface PromptSectionAudit {
  name: string

  decision:
    | 'allowed'
    | 'blocked'
    | 'protected'

  reason: string

  chars: number

  estimatedTokens?: number

  preview?: string
}
```

И aggregate:

```ts
interface PromptAuditResult {
  totalSections: number
  allowedSections: number
  blockedSections: number

  charsBefore: number
  charsAfter: number
  charsRemoved: number

  estimatedTokensBefore?: number
  estimatedTokensAfter?: number
  estimatedTokensRemoved?: number
}
```

---

# 15. Token estimation

Не требуется использовать tokenizer конкретной модели.

Для MVP достаточно приблизительной оценки.

Например:

```text
estimatedTokens ~= chars / 4
```

Но в UI обязательно маркировать это как estimate.

Если DSH уже предоставляет tokenizer/token-count API, использовать его вместо эвристики.

---

# 16. Logging

Пример:

```text
[prompt-firewall] assembled prompt
  sections: 14
  chars: 18432
  estimated tokens: ~4608

[prompt-firewall] BLOCK plugin:dsh-ssh
  reason: blockedSections
  chars: 1240
  estimated tokens: ~310

[prompt-firewall] BLOCK plugin:task-board
  reason: blockedSections
  chars: 1512
  estimated tokens: ~378

[prompt-firewall] result
  removed sections: 2
  removed chars: 2752
  estimated tokens saved: ~688
```

Не логировать содержимое prompt по умолчанию.

---

# 17. Privacy

`includePreview` default:

```yaml
false
```

Потому что system prompt может содержать:

- workspace paths;
- внутренние инструкции;
- секреты других плагинов;
- user/project metadata.

Если preview включён:

```yaml
includePreview: true
previewChars: 160
```

показывать только первые N символов.

---

# 18. UI

Если monorepo уже содержит Web UI extension infrastructure, добавить страницу/карточку:

```text
Settings
  → Plugins
    → Prompt Firewall
```

Минимальный UI:

### Status

```text
Prompt Firewall: Enabled
Mode: Blocklist

Last request:
14 sections
2 blocked
~688 tokens removed
```

### Rules

Таблица:

| Rule | Type | Action |
|---|---|---|
| plugin:dsh-ssh | exact | block |
| plugin:task-board | exact | block |
| announcement: | prefix | block |

Кнопки:

```text
Add rule
Remove
Enable/Disable
```

---

# 19. Prompt Inspector

Желательно сделать отдельный inspector.

Пример:

| Section | Size | Decision | Reason |
|---|---:|---|---|
| harness:identity | ~120 t | Protected | Core |
| runtime:context | ~340 t | Protected | Core |
| tool:subagent | ~410 t | Allowed | Default |
| plugin:dsh-ssh | ~310 t | Blocked | Exact rule |
| plugin:task-board | ~378 t | Blocked | Exact rule |

По клику:

```text
Section details
```

с preview, только если это разрешено настройками.

---

# 20. Per-section actions from UI

Полезный UX:

возле каждой найденной секции:

```text
Allow
Block
Protect
```

Нажатие автоматически добавляет соответствующее rule в config.

Например пользователь увидел:

```text
plugin:some-random-plugin
```

и нажал:

```text
Block
```

после чего автоматически появляется:

```yaml
blockedSections:
  - plugin:some-random-plugin
```

---

# 21. New section detection

Плагин должен помнить известные section names за время жизни Host.

Если появляется новая plugin section:

```text
plugin:new-plugin
```

audit subsystem отмечает:

```text
NEW
```

Опциональная настройка:

```yaml
audit:
  highlightNewSections: true
```

Никаких автоматических блокировок по факту новизны в default mode.

---

# 22. `announceToAgent` integration

`dsh-prompt-firewall` не должен напрямую менять конфигурацию чужих плагинов.

То есть НЕ нужно:

```ts
plugin.config.announceToAgent = false
```

Причины:

- не все плагины используют эту настройку;
- config schema принадлежит другому plugin;
- название может измениться;
- появляются hidden coupling;
- настройка может иметь legitimate use.

Firewall работает независимо от механизма, которым секция попала в prompt.

Это делает его универсальным.

---

# 23. Optional future feature: config advisor

В v2 можно добавить advisory mechanism:

```text
This section appears to come from dsh-ssh.

The plugin exposes:
announceToAgent = true

Suggestion:
Disable announcement at source.
```

Но firewall всё равно должен продолжать работать без этой интеграции.

---

# 24. Middleware ordering

Нужно протестировать ситуацию:

```text
plugin A adds section
plugin B adds section
prompt-firewall filters
plugin C modifies assembly
```

Firewall должен стараться выполняться максимально поздно.

Если Cordis / DSH поддерживает priority/order hooks, выбрать priority для late-stage processing.

Если order API отсутствует, задокументировать limitation.

Нельзя полагаться исключительно на package load order.

---

# 25. `complete` prompt handling

Если DSH поддерживает special section/assembly semantics вида complete replacement, firewall не должен пытаться поломать их обходным monkey-patch'ем.

Поведение:

```text
complete prompt detected
```

Audit:

```text
Firewall bypassed because prompt assembly is complete/replaced.
```

Если API позволяет безопасно inspecting final complete prompt — показать audit.

Но MVP не должен насильно разбирать complete prompt обратно на секции.

---

# 26. Fail-open behavior

Критически важно:

при внутренней ошибке firewall запрос к модели НЕ должен падать.

Поведение:

```ts
try {
  return filterPrompt(...)
} catch (error) {
  logger.error(...)
  return originalPrompt
}
```

То есть:

```text
fail-open
```

а не:

```text
fail-closed
```

Default.

Дополнительно можно позже добавить:

```yaml
failurePolicy: allow
```

Но для MVP достаточно фиксированного fail-open.

---

# 27. Performance

Firewall выполняется на каждый model request.

Поэтому:

- правила компилировать один раз;
- `Set` для exact rules;
- prefixes хранить подготовленными;
- glob patterns предварительно компилировать;
- не выполнять тяжёлые regex/tokenizer операции без необходимости;
- audit history ограничить ring buffer.

Target overhead:

```text
< 1 ms
```

для обычных 10–50 секций без tokenizer.

---

# 28. Audit history

Хранить последние:

```text
100
```

assemblies по умолчанию.

```yaml
audit:
  historySize: 100
```

Только в памяти.

Не писать prompt content на диск автоматически.

Если понадобится persistent history — отдельная future feature.

---

# 29. Metrics

Если DSH/monorepo уже экспортирует metrics, предусмотреть:

```text
dsh_prompt_firewall_requests_total

dsh_prompt_firewall_sections_total
dsh_prompt_firewall_sections_blocked_total

dsh_prompt_firewall_chars_removed_total
dsh_prompt_firewall_estimated_tokens_removed_total
```

Labels держать минимальными.

НЕ делать label:

```text
section="<arbitrary section name>"
```

если backend Prometheus/OTel может получить high cardinality.

Лучше aggregate metrics + данные по секциям только в UI/logs.

---

# 30. Public service API

Плагин может экспортировать internal service:

```ts
interface PromptFirewallService {
  inspectLast(): PromptAuditResult | null

  getKnownSections(): KnownSection[]

  evaluateSection(
    section: PromptSection,
  ): FirewallDecision

  reloadRules(): void
}
```

Это позволит другим UI-плагинам интегрироваться без чтения internal state.

---

# 31. Rule engine separation

Rule evaluation обязательно вынести из DSH integration.

```ts
evaluateSection(section, rules)
```

Pure function.

Например:

```ts
const decision = evaluateSection(
  {
    name: 'plugin:dsh-ssh',
    text: '...',
  },
  compiledRules,
)
```

Результат:

```ts
{
  action: 'block',
  reason: 'exact-block',
  rule: 'plugin:dsh-ssh',
}
```

Это сильно упростит тестирование.

---

# 32. Suggested implementation model

```text
DSH
 │
 │ system-prompt/assemble
 ▼
Prompt Firewall
 │
 ├── normalize assembly
 │
 ├── inspect sections
 │
 ├── core protection
 │
 ├── evaluate rules
 │
 ├── audit
 │
 └── filter
 │
 ▼
Final PromptAssembly
 │
 ▼
LLM provider
```

---

# 33. Tests

## Unit: exact rule

Input:

```text
plugin:dsh-ssh
```

Config:

```text
blockedSections = ['plugin:dsh-ssh']
```

Expected:

```text
blocked
```

---

## Unit: prefix

```text
plugin:advertisement:foo
```

Rule:

```text
plugin:advertisement:
```

Expected:

```text
blocked
```

---

## Unit: protected wins

Section:

```text
tool:run_code
```

Config:

```yaml
blockedPrefixes:
  - tool:

protectCoreSections: true
```

Expected:

```text
allowed/protected
```

---

## Unit: explicit allow wins

```yaml
allowedSections:
  - plugin:foo

blockedPrefixes:
  - plugin:
```

Expected:

```text
plugin:foo -> allowed
```

---

## Unit: unknown section in blocklist

Expected:

```text
allowed
```

---

## Unit: unknown section in strict allowlist

Expected:

```text
blocked
```

unless protected.

---

## Unit: fail-open

Force rule engine exception.

Expected:

```text
original assembly returned
```

---

# 34. Integration tests

Create fake plugins:

```text
fake-clean-plugin
fake-announcement-plugin
fake-tool-plugin
```

They inject:

```text
plugin:clean
plugin:announcement
tool:fake-tool
```

Verify final assembly in:

```text
audit
blocklist
allowlist
```

modes.

---

# 35. Regression test for known noisy plugins

Fixture:

```text
plugin:dsh-liangshen
plugin:dsh-ssh
plugin:task-board
plugin:dsh-desktop-launcher
```

With preset `clean`:

Expected:

```text
all removed
```

Core/tool sections unchanged.

---

# 36. README examples

## Basic

```yaml
- id: dsh-prompt-firewall
  config:
    mode: blocklist

    blockedSections:
      - plugin:dsh-ssh
      - plugin:task-board
```

---

## Audit everything

```yaml
- id: dsh-prompt-firewall
  config:
    mode: audit

    audit:
      enabled: true
      logAllowed: true
```

---

## Strict

```yaml
- id: dsh-prompt-firewall
  config:
    mode: allowlist

    allowedSections:
      - plugin:my-important-plugin

    protectCoreSections: true
```

---

# 37. UX defaults

Recommended defaults:

```yaml
enabled: true

mode: blocklist

protectCoreSections: true

unknownPluginPolicy: allow

audit:
  enabled: true
  logBlocked: true
  logAllowed: false
  includePreview: false
```

Known announcement sections may come from `clean` preset.

---

# 38. MVP

Первая рабочая версия должна включать:

- `system-prompt/assemble` integration;
- `blocklist`;
- `audit`;
- exact rules;
- prefix rules;
- protected sections;
- core protection;
- fail-open;
- logging;
- in-memory last audit result;
- тесты;
- preset для известных noisy plugins.

UI не является blocker для MVP.

---

# 39. v1

После MVP:

- Settings UI;
- Prompt Inspector;
- allow/block/protect buttons;
- glob rules;
- known/new sections;
- audit history;
- approximate token savings;
- metrics.

---

# 40. Future

Можно рассмотреть:

### Per-workspace rules

```yaml
workspaces:
  /workspace/foo:
    blockedSections:
      - plugin:foo
```

### Per-agent preset

```yaml
agents:
  coding:
    preset: strict

  general:
    preset: clean
```

### Per-provider rules

Например более агрессивно чистить prompt для моделей с маленьким context window.

### Budget enforcement

```yaml
maxPluginPromptTokens: 1500
```

Но automatic truncation не делать без отдельного дизайна.

### Prompt diff

Показывать:

```text
before firewall
after firewall
```

структурно по секциям.

---

# 41. Security considerations

Плагин нельзя рассматривать как security boundary.

Он помогает контролировать system prompt pollution, но:

- другой плагин может менять сообщения через другой middleware;
- instructions могут попасть через workspace prompt;
- tool descriptions тоже являются частью agent context;
- complete prompt replacement может обходить normal sections;
- malicious plugin имеет кодовые права внутри Host.

Поэтому позиционировать как:

```text
Prompt hygiene + observability + policy layer
```

а не sandbox.

---

# 42. Acceptance criteria

Функция считается готовой, когда:

1. `dsh-prompt-firewall` устанавливается как обычный plugin DSH.

2. Без firewall поведение Harness не изменяется.

3. В `audit` режиме final system prompt остаётся идентичным исходному.

4. В `blocklist` режиме указанные section names отсутствуют в final assembly.

5. Остальные секции остаются byte-for-byte неизменными.

6. `protectCoreSections=true` не позволяет обычным правилам удалить критические DSH/tool sections.

7. Известные секции:

```text
plugin:dsh-liangshen
plugin:dsh-ssh
plugin:task-board
plugin:dsh-desktop-launcher
```

можно удалить одной preset-конфигурацией.

8. При исключении внутри firewall запрос продолжает выполняться с исходным prompt.

9. Content system prompt не логируется по умолчанию.

10. Audit показывает минимум:

```text
section name
decision
reason
chars
estimated tokens
```

11. Unit и integration tests проходят в CI.

---

# 43. Recommended first implementation

Сначала реализовать только core package:

```text
config
rules
firewall
audit
DSH hook
tests
```

Не начинать с UI.

Порядок:

```text
1. Поднять skeleton package.
2. Подключить system-prompt/assemble.
3. Сделать audit-only и снять snapshot реального PromptAssembly.
4. Реализовать exact block rules.
5. Добавить core protection.
6. Добавить prefix/glob.
7. Добавить preset clean.
8. Написать integration tests.
9. После стабилизации API делать Web UI.
```

На важных этапах делать отдельные commits:

```text
feat(prompt-firewall): scaffold plugin

feat(prompt-firewall): add prompt assembly audit

feat(prompt-firewall): add section filtering rules

feat(prompt-firewall): protect core prompt sections

feat(prompt-firewall): add clean preset

test(prompt-firewall): add integration coverage

feat(prompt-firewall): add settings UI
```

---

# 44. Result

После установки пользователь получает централизованную защиту от prompt pollution:

```text
Plugin adds system prompt section
             │
             ▼
      dsh-prompt-firewall
       │             │
       │ allowed     │ blocked
       ▼             X
  Final prompt
       │
       ▼
      Model
```

Главный принцип:

> Plugin functionality should not imply unrestricted access to the model's system prompt.

`announceToAgent` остаётся полезной возможностью для тех плагинов, которым действительно нужно сообщить агенту инструкции, но решение о том, что попадёт в итоговый prompt, остаётся под контролем пользователя.