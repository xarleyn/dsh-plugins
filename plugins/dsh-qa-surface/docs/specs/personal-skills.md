# SPEC / PLAN: Personal Skills & Unified User Settings for `dsh-qa-surface`

**Status:** proposed / ready for implementation  
**Target repository:** `xarleyn/dsh-plugins`  
**Target plugin:** `plugins/dsh-qa-surface`  
**Target DSH line:** `dsh-v0.1.5-rc.2`  
**Primary goal:** добавить в QA Surface полноценные персональные Skills, управляемые через единый пользовательский Settings UI, без создания собственного несовместимого формата skills и без расширения полномочий QA-сессии.

---

## 1. Контекст

Сейчас в `dsh-qa-surface` у пользователя есть отдельная модалка **«Профиль»**, в которой редактируются:

- Email;
- ФИО;
- общие инструкции для ассистента.

Также QA Surface умеет закреплять `cwd` сессии за личным каталогом пользователя. Это позволяет использовать personal filesystem пользователя как естественную область хранения его настроек и файлов.

Нужно расширить эту модель:

1. заменить отдельную модалку «Профиль» на общую модалку **«Настройки»**, визуально и структурно похожую на Settings оригинального DSH;
2. перенести текущий профиль в отдельный раздел новой модалки;
3. добавить раздел персональных Skills;
4. хранить Skills пользователя в его личном каталоге;
5. автоматически делать эти Skills доступными в его QA-сессиях;
6. добавить удобный визуальный редактор Skills;
7. добавить выбор tools для Skill;
8. сохранять tool list в переносимом `SKILL.md`;
9. гарантировать, что Skill не может расширять фактически доступные пользователю инструменты.

---

## 2. Ключевые архитектурные решения

### 2.1. Skills остаются обычными DSH / Agent Skills

Не вводить proprietary JSON-формат Skill как primary storage.

Canonical source of truth:

```text
<personal-cwd>/.dsh/skills/<skill-name>/SKILL.md
```

Пример:

```text
/data/qa-users/alice/
└── .dsh/
    └── skills/
        ├── api-testing/
        │   └── SKILL.md
        └── jira-investigation/
            ├── SKILL.md
            ├── references/
            └── assets/
```

Преимущества:

- совместимость с DSH;
- переносимость;
- ручное редактирование возможно без QA Surface;
- нет миграции при дальнейшем развитии DSH;
- Skills можно экспортировать/копировать как обычные каталоги;
- progressive disclosure остаётся на стороне нативной skill-системы DSH.

### 2.2. Не использовать общий `$DSH_HOME/skills` как personal storage

QA Surface может обслуживать несколько пользователей в одном DSH instance.

Поэтому:

```text
$DSH_HOME/skills
```

считается host/global storage и **не должен** использоваться для пользовательских QA Skills.

Personal storage должен всегда вычисляться из авторизованного QA user context:

```text
<canonical-personal-cwd>/.dsh/skills
```

### 2.3. Не делать собственный prompt injection для тела Skill

Skill должен попадать в стандартный `ctx.skills` registry.

Модель должна видеть metadata/catalog Skill, а полное содержимое `SKILL.md` должно загружаться нативным механизмом DSH при фактическом использовании Skill.

Не следует:

- добавлять полный body всех Skills в system prompt;
- дублировать нативный `skill` tool;
- создавать отдельную QA-команду загрузки Skill, если можно использовать DSH.

### 2.4. Рекомендуется отдельный `qa-user-skills` provider

Нативный `dsh-skill-filesystem` определяет project root через ближайший `.git`. Для multi-user QA Surface это может быть нежелательно: personal cwd может оказаться внутри более крупного Git workspace и discovery уйдёт выше личного каталога.

Поэтому целевая реализация должна иметь небольшой provider:

```text
qa-user-skills
```

который:

- получает `cwd` / scope текущей QA-сессии;
- через QA user/session resolver определяет canonical personal root;
- разрешает только `<personal-root>/.dsh/skills`;
- не ищет родительский `.git`;
- не выходит за personal root;
- регистрирует Skills через официальный `ctx.skills.registerProvider(...)`;
- поддерживает invalidation после CRUD;
- при необходимости watch'ит ручные изменения файлов.

Для первого технического spike допустимо проверить работу через штатный filesystem provider, но production-решение должно иметь явную user isolation boundary.

---

## 3. Unified Settings UI

### 3.1. Entry point

Текущая кнопка, открывающая «Профиль», должна открывать общую модалку:

```text
Настройки
```

Отдельная модалка «Профиль» после миграции удаляется.

### 3.2. Layout

Визуальная модель — аналог Settings оригинального DSH:

```text
┌──────────────────────────────────────────────────────────────┐
│ Настройки                                                  × │
├─────────────────┬────────────────────────────────────────────┤
│ Профиль         │                                            │
│ Общие           │                CONTENT                     │
│ Навыки          │                                            │
│                 │                                            │
│                 │                                            │
└─────────────────┴────────────────────────────────────────────┘
```

Минимальные разделы v1:

1. **Профиль**
2. **Общие**
3. **Навыки**

Архитектура sidebar должна позволять потом без переделки shell добавить:

- Интеграции;
- Внешние системы;
- Уведомления;
- Конфиденциальность;
- другие user-scoped настройки.

### 3.3. Профиль

Перенести существующие поля без изменения их семантики:

- Email;
- ФИО;
- Общие инструкции для агента.

Существующие данные и backend storage должны быть переиспользованы.

Важно:

- миграция UI не должна менять значения профиля;
- старые сохранённые профили автоматически отображаются в новом Settings shell;
- текущая подсказка о том, что инструкции не расширяют доступ к инструментам, сохраняется.

### 3.4. Общие

Раздел создаётся как место для текущих/будущих user preferences.

Если на момент реализации отдельных настроек почти нет, допустимо иметь минимальную страницу, но сам route/section должен существовать.

Не переносить сюда host/admin настройки DSH.

---

## 4. Раздел «Навыки»

### 4.1. Catalog view

Главный экран:

```text
Навыки                                      [+ Создать навык]

[ Поиск навыков...                                      ]

API testing
Тестирование REST и GraphQL API
Авто · /api-testing · 5 инструментов                 >

Jira investigation
Поиск и анализ Jira-задач
Авто · 3 инструмента                                  >
```

Для каждого Skill показывать:

- `name`;
- `description`;
- model invocation status;
- user invocation status;
- количество tools;
- validation status;
- warning, если присутствуют неизвестные/недоступные tools.

### 4.2. Search

Поиск минимум по:

- `name`;
- `description`;
- `whenToUse`.

Поиск client-side допустим, если каталог небольшой.

### 4.3. Empty state

Если Skills нет:

```text
У вас пока нет навыков.

Навык — это набор инструкций, который помогает ассистенту
стабильно выполнять повторяющиеся задачи.

[Создать первый навык]
```

Не показывать пользователю filesystem path как основной UX.

---

## 5. Создание Skill

### 5.1. Create flow

По кнопке `+ Создать навык` открывать editor в правой content area Settings, а не вложенную modal-inside-modal.

Минимальные поля:

#### Основное

- Название / slug;
- Описание;
- Когда использовать.

#### Инструменты

- выбранные tools;
- кнопка `Добавить инструменты`.

#### Поведение

- Агент может использовать автоматически;
- Доступен пользователю как `/skill-name`.

#### Инструкции

- Markdown body.

### 5.2. UI labels

Предпочтительные русские названия:

```text
Название
Описание
Когда использовать
Инструменты
Инструкции

[ ] Агент может использовать навык автоматически
[ ] Доступен как /<name>
```

Не использовать термин `Auto load`: он создаёт впечатление, что body Skill постоянно загружается в context window.

### 5.3. Name

Имя Skill должно быть kebab-case и совместимо с Agent Skills / DSH.

Минимальная validation:

- 1–64 символа;
- lowercase ASCII letters;
- digits;
- `-`;
- не начинается и не заканчивается `-`;
- без `--`;
- directory name должен совпадать с `name`.

Пример:

```text
jira-investigation
```

При вводе пользовательского title можно предлагать slug автоматически, но после ручного изменения slug нельзя неожиданно перегенерировать.

### 5.4. Description

`description` обязательный.

Рекомендуемый UI hint:

```text
Кратко опишите, что делает навык и в каких ситуациях его стоит использовать.
```

Максимум: 1024 символа.

### 5.5. whenToUse

DSH-specific optional field.

UI показывает отдельное поле, поскольку оно удобно пользователю, даже если часть Agent Skills ecosystems полагается только на `description`.

Если пусто — поле не сериализуется.

### 5.6. Instructions

Markdown editor.

v1 достаточно:

- textarea/editor;
- monospace для code blocks;
- сохранение body как Markdown.

Rich WYSIWYG не требуется.

Опционально добавить split preview позже.

---

## 6. `SKILL.md` schema

QA Surface должен сериализовать YAML через нормальную YAML-библиотеку, а не собирать frontmatter строковой конкатенацией.

Пример:

```yaml
---
name: jira-investigation
description: Investigate Jira issues and related source code.
whenToUse: Use when the user asks to investigate a Jira issue.
user-invocable: true
disable-model-invocation: false
allowed-tools: jira_search jira_get read grep
---

# Jira investigation

1. Read the issue.
2. Locate the related code.
3. Compare implementation and expected behavior.
4. Report findings with evidence.
```

### 6.1. Supported fields

v1:

```text
name
description
whenToUse
user-invocable
disable-model-invocation
allowed-tools
```

Также parser должен **сохранять неизвестные frontmatter fields**, если пользователь открыл существующий Skill и затем сохранил его через UI.

Нельзя при round-trip удалять:

```text
license
compatibility
metadata
custom vendor fields
```

### 6.2. Invocation mapping

UI:

```text
Agent can use automatically = true
```

сериализуется как:

```yaml
disable-model-invocation: false
```

UI:

```text
Agent can use automatically = false
```

как:

```yaml
disable-model-invocation: true
```

UI:

```text
Available as /name
```

сериализуется через:

```yaml
user-invocable: true
```

### 6.3. `allowed-tools`

Agent Skills specification определяет `allowed-tools` как experimental space-separated string.

Canonical format, который пишет QA Surface:

```yaml
allowed-tools: read grep jira_search jira_get
```

Internal representation:

```ts
string[]
```

Parser желательно делать tolerant:

- canonical scalar space-separated string — обязательно;
- YAML array — можно принять для совместимости и нормализовать;
- duplicate values удалять;
- исходный Skill при сохранении нормализовать в canonical string.

---

## 7. Tool Picker

### 7.1. Источник списка tools

Список не хардкодить.

Host/backend получает tools из runtime DSH registry, используя scope текущего QA пользователя/сессии:

```text
ctx.tools.schemas(scope)
```

UI получает минимум:

```ts
interface QaToolDescriptor {
  name: string
  description?: string
  available: boolean
  group?: string
  source?: string
}
```

`parameters` для UI не требуется отдавать, если они не используются.

### 7.2. Tool picker UI

Пример:

```text
Добавить инструменты                       4 выбрано

[ Поиск инструментов...                              ]

Files
[x] read        Read file contents
[x] grep        Search file contents
[ ] write       Write file contents

Web
[x] web_search  Search the web
[ ] web_fetch   Fetch page contents

Jira
[x] jira_get
[x] jira_search

                         [Отмена] [Применить]
```

Требования:

- search;
- multi-select;
- selected count;
- keyboard navigation;
- сохранить выбор только по `name`;
- описание secondary text;
- группы по plugin/source/category, если metadata доступна;
- если групп нет — алфавитный список.

### 7.3. Выбранные tools в editor

После выбора:

```text
Инструменты                               4 выбрано
[ jira_get × ] [ jira_search × ] [ read × ] [ grep × ]

[+ Добавить инструменты]
```

### 7.4. Unknown / unavailable tools

Skill может быть импортирован из другой среды или tool может исчезнуть после отключения plugin.

Нельзя молча удалять его при Save.

Показывать:

```text
⚠ jira_transition
  Сейчас недоступен в этой конфигурации QA Surface.
```

Unknown tool:

- остаётся в `allowed-tools`;
- показывается в editor;
- может быть удалён пользователем вручную;
- не считается доступным runtime capability.

### 7.5. Security semantics

**Критическое правило:**

> `allowed-tools` никогда не расширяет полномочия QA session.

Effective tools вычисляются как intersection:

```text
effectiveSkillTools =
    sessionVisibleTools
    ∩ declaredAllowedTools
```

Если Skill содержит:

```text
bash
write
jira_transition
```

но сессия разрешает только:

```text
read
grep
```

Skill не получает дополнительные `bash`, `write`, `jira_transition`.

### 7.6. Runtime enforcement

В DSH `allowed-tools` filesystem provider сам по себе не является полноценным runtime enforcement механизмом.

Поэтому разделить две ответственности:

#### Обязательно в v1

- редактирование tools через UI;
- хранение `allowed-tools`;
- validation;
- отображение доступности;
- запрет трактовать `allowed-tools` как выдачу permissions.

#### Runtime restriction

Если QA Surface уже имеет место, где при активации Skill можно определить активный Skill и tool scope, использовать intersection-only restriction через DSH tool scope/restriction/guard primitives.

Если такого lifecycle seam в текущем plugin нет, enforcement оформить отдельным этапом и не делать небезопасную эмуляцию через prompt.

Нельзя обещать enforcement в UI, пока он реально не подключён.

В UI v1 лучше использовать текст:

```text
Инструменты, которые использует этот навык.
Они не предоставляют дополнительных разрешений.
```

а не:

```text
Разрешения навыка
```

---

## 8. Skill detail / editor

Целевая страница:

```text
← Навыки                            [Удалить] [Сохранить]

Название
[ jira-investigation                                  ]

Описание
[ Анализ Jira-задач и связанного кода                 ]

Когда использовать
[ Когда пользователь просит исследовать задачу Jira   ]

Поведение
[x] Агент может использовать навык автоматически
[x] Доступен как /jira-investigation

Инструменты                                      4 выбрано
[ jira_get × ] [ jira_search × ] [ read × ] [ grep × ]
[+ Добавить инструменты]

Инструкции
┌────────────────────────────────────────────────────┐
│ Markdown                                           │
│                                                    │
└────────────────────────────────────────────────────┘

Дополнительно ▸

                                  [Сохранить]
```

### 8.1. Advanced

В `Дополнительно`:

- `Preview SKILL.md`;
- validation diagnostics;
- source path в read-only форме для advanced users;
- preserved custom frontmatter view;
- позже — license / compatibility.

Raw editor всего файла в v1 не обязателен.

---

## 9. Preview

Добавить read-only `Предпросмотр SKILL.md`.

Цель:

- пользователь понимает, что хранится обычный переносимый Skill;
- удобно дебажить frontmatter;
- не нужен доступ к host filesystem.

Preview должен строиться из того же serializer, который будет использован для Save.

---

## 10. Personal Skill Service

Создать отдельный backend/host service, условно:

```ts
PersonalSkillService
```

Responsibilities:

- resolve personal root;
- list;
- get;
- create;
- update;
- delete;
- validate;
- serialize/parse;
- invalidate DSH skill provider;
- безопасная filesystem работа.

Предлагаемый interface:

```ts
interface PersonalSkillService {
  list(context: QaUserContext): Promise<PersonalSkillSummary[]>
  get(context: QaUserContext, name: string): Promise<PersonalSkillDocument>
  create(context: QaUserContext, input: CreateSkillInput): Promise<PersonalSkillDocument>
  update(
    context: QaUserContext,
    name: string,
    input: UpdateSkillInput,
  ): Promise<PersonalSkillDocument>
  remove(context: QaUserContext, name: string): Promise<void>
  validate(input: SkillDraft): SkillValidationResult
}
```

---

## 11. API

Конкретный transport можно адаптировать под существующий Host/Web bridge `dsh-qa-surface`.

Логическая API surface:

```text
GET    /api/qa/settings/profile
PUT    /api/qa/settings/profile

GET    /api/qa/skills
GET    /api/qa/skills/:name
POST   /api/qa/skills
PUT    /api/qa/skills/:name
DELETE /api/qa/skills/:name

GET    /api/qa/skills/tools
POST   /api/qa/skills/validate
```

### 11.1. List DTO

```ts
interface PersonalSkillSummary {
  name: string
  description: string
  whenToUse?: string

  modelInvocable: boolean
  userInvocable: boolean

  allowedTools: string[]
  unavailableTools: string[]

  valid: boolean
  diagnostics: SkillDiagnostic[]

  updatedAt: string
  revision: string
}
```

### 11.2. Detail DTO

```ts
interface PersonalSkillDocument {
  name: string
  description: string
  whenToUse?: string

  modelInvocable: boolean
  userInvocable: boolean

  allowedTools: string[]
  body: string

  extraFrontmatter: Record<string, unknown>

  valid: boolean
  diagnostics: SkillDiagnostic[]

  revision: string
}
```

### 11.3. Optimistic concurrency

Каждый read возвращает:

```text
revision
```

Рекомендуемо:

```text
sha256(normalized current file bytes)
```

Update отправляет:

```text
expectedRevision
```

Если файл был изменён вручную/в другой вкладке:

```text
409 Conflict
```

UI:

```text
Навык был изменён в другом месте.
Перезагрузите текущую версию или сохраните копию.
```

Не перетирать изменения молча.

---

## 12. Filesystem safety

Personal skill storage является security boundary.

### 12.1. Root resolution

Browser/client **никогда не передаёт filesystem root**.

Нельзя принимать:

```json
{
  "root": "/data/users/alice"
}
```

Host сам определяет root по authenticated QA user/session context.

### 12.2. Canonicalization

Перед любой операцией:

1. resolve user personal root;
2. canonicalize/realpath;
3. построить target;
4. убедиться, что target остаётся внутри root;
5. не доверять symlink.

### 12.3. Path traversal

Запретить:

- `..`;
- `/`;
- `\`;
- absolute paths;
- null bytes;
- нестандартные directory aliases.

Skill path создаётся только из validated slug.

### 12.4. Symlinks

v1:

- не создавать symlinks;
- reject writable Skill directory, если canonical path выходит за personal skill root;
- external symlink targets не редактировать через UI.

Для обнаруженного вручную Skill с symlink можно показывать read-only warning или скрыть его согласно security policy.

### 12.5. Atomic save

Save:

1. serialize;
2. write temp file в том же каталоге;
3. fsync при необходимости;
4. atomic rename/replace.

Не писать `SKILL.md` частями.

### 12.6. Limits

Рекомендуемые defaults:

```text
SKILL.md max size:       256 KiB
description:             1024 chars
whenToUse:               2048 chars
name:                    64 chars
max selected tools:      256
```

Limits сделать constants/configurable where useful.

---

## 13. Delete / Trash

Не удалять Skill без подтверждения.

v1 предпочтительно soft delete:

```text
<personal-root>/.dsh/skills-trash/
```

Например:

```text
skills-trash/
└── jira-investigation-20260914T153010Z/
```

Flow:

```text
Удалить навык «jira-investigation»?
Его можно будет восстановить вручную из корзины.

[Отмена] [Удалить]
```

Если Trash сильно усложняет v1 — допустим hard delete только после explicit confirm, но service interface желательно спроектировать так, чтобы позже добавить restore.

---

## 14. Resources

Стандартный Skill может содержать:

```text
references/
assets/
scripts/
```

### v1

Primary editor управляет только `SKILL.md`.

Существующие дополнительные файлы:

- не удалять;
- не перезаписывать;
- сохранять каталог Skill целиком;
- показывать факт наличия ресурсов при необходимости.

### v1.1 / later

Добавить UI:

```text
Инструкции | References | Files
```

Разрешить:

- `.md` references;
- text/json/yaml assets;
- upload/download assets.

### Scripts

Создание/редактирование executable `scripts/` через QA UI в v1 **не входит**.

Причина: отдельная модель риска и permissions.

---

## 15. Skill discovery provider

### 15.1. Provider contract

Логически:

```ts
ctx.skills.registerProvider(({ signal, invalidate }) => {
  return createQaUserSkillProvider({
    signal,
    invalidate,
    resolvePersonalRoot,
  })
})
```

`list(options)`:

- принимает DSH lookup options;
- проверяет, что scope/cwd относится к QA user session;
- resolve personal root;
- scan `<personal-root>/.dsh/skills`;
- возвращает summaries/candidates.

`get/load`:

- повторно проверяет boundary;
- читает актуальный файл;
- возвращает body/resourceBase.

### 15.2. Isolation

Provider не должен:

- возвращать Skills другого QA user;
- использовать arbitrary cwd пользователя как trusted path;
- сканировать parent directories;
- наследовать Skills другого personal root.

### 15.3. Global skills

Если продукт сознательно поддерживает global/admin Skills, они могут оставаться отдельным provider/source.

При конфликте имени нужно явно задокументировать precedence.

Рекомендуемая политика QA Surface:

```text
personal QA Skill
    >
global QA/admin Skill
    >
host generic Skill
```

только внутри QA scope пользователя.

Не менять precedence глобального DSH вне QA Surface.

---

## 16. Live refresh

После Save/Create/Delete новый Skill должен стать доступен без restart DSH.

Механизм:

- CRUD service вызывает provider `invalidate()`;
- registry генерирует обычный skill change lifecycle;
- следующий catalog read видит новую версию.

Если поддерживается ручное filesystem редактирование:

- добавить Chokidar watch только на разрешённые personal roots;
- lazy watcher registration;
- лимит watchers;
- cleanup при dispose.

Не требуется держать watcher на всех потенциальных пользователях до их первого использования.

---

## 17. Validation

### Blocking errors

- invalid skill name;
- empty description;
- malformed YAML/frontmatter;
- body/skill > configured limit;
- duplicate skill on create;
- path boundary violation;
- invalid `allowed-tools` value type после normalization failure.

### Warnings

- tool не существует в текущем scope;
- `whenToUse` пустой;
- Skill не invocable ни моделью, ни пользователем;
- optional field неизвестен;
- ресурсный каталог содержит неподдерживаемые UI файлы;
- Skill был изменён вне QA Surface.

Warnings не должны автоматически ломать Skill, если DSH способен его использовать.

---

## 18. Error UX

Ошибки показывать рядом с соответствующим полем + toast для общего failure.

Примеры:

```text
Название может содержать только a-z, 0-9 и дефисы.
```

```text
Инструмент jira_transition сейчас недоступен, но останется в файле.
```

```text
Не удалось сохранить навык: файл был изменён в другом месте.
```

```text
Навык сохранён, но DSH не смог обновить каталог.
```

Последний случай должен логироваться отдельно: storage success и runtime invalidation — разные этапы.

---

## 19. Frontend component plan

Логическая структура:

```text
SettingsDialog
├── SettingsSidebar
├── ProfileSettingsPage
├── GeneralSettingsPage
└── SkillsSettingsPage
    ├── SkillCatalog
    ├── SkillCatalogItem
    ├── SkillEditor
    ├── SkillToolPicker
    ├── SkillValidationPanel
    └── SkillFilePreview
```

Если текущий frontend плагина использует другую component organization — сохранить существующий style, но логические responsibilities не смешивать.

### State

Разделить:

- server state: skill list/detail/tools;
- dirty editor draft;
- selected section;
- tool picker temporary selection.

Не обновлять server state на каждый keypress.

---

## 20. Visual style

Новая модалка должна быть визуально близка к Settings оригинального DSH:

- sidebar слева;
- content справа;
- один modal shell;
- light/dark theme tokens;
- border/divider pattern как в DSH;
- compact rows;
- без вложенных модалок для обычного Skill editor.

Допустима отдельная modal/popover для Tool Picker и destructive confirmation.

### Responsive

На узких экранах:

```text
Settings list
    ↓
section page
```

Sidebar может превращаться в отдельный navigation screen.

---

## 21. Compatibility with existing profile

Migration:

```text
old Profile button
    ↓
SettingsDialog(section="profile")
```

Backend profile endpoints/storage не менять без необходимости.

Acceptance:

- все текущие профили открываются;
- Email/ФИО/инструкции не теряются;
- Save работает как раньше;
- старый entry point больше не создаёт отдельную modal implementation.

---

## 22. Configuration

Большинство функций должны работать zero-config.

При необходимости добавить plugin config:

```ts
interface PersonalSkillsConfig {
  enabled?: boolean              // default true
  relativeRoot?: string          // default ".dsh/skills"
  watch?: boolean                // default true
  maxSkillBytes?: number         // default 262144
  allowResourceEditing?: boolean // default false
}
```

`relativeRoot`:

- только relative safe path;
- нельзя использовать для выхода из personal root.

Не давать browser user менять host-level root.

---

## 23. Audit / logging

Полезно логировать host-side:

```text
skill.create
skill.update
skill.delete
skill.validation_failed
skill.provider.invalidate_failed
```

Минимальные поля:

- stable internal user id/hash;
- skill name;
- action;
- timestamp;
- error code.

Не писать body Skill и пользовательские инструкции целиком в обычный log.

---

## 24. Testing

### 24.1. Unit

`SkillNameValidator`

- valid/invalid slugs;
- boundaries;
- max length.

`SkillSerializer`

- create;
- round-trip;
- YAML quoting;
- colon/newline/Unicode;
- unknown frontmatter preservation;
- allowed-tools normalization.

`SafePathResolver`

- traversal;
- symlink escape;
- absolute path;
- Windows separators;
- Linux paths.

`ToolListNormalizer`

- canonical string;
- array compatibility;
- duplicates;
- unknown tools.

### 24.2. Service integration

- create Skill;
- list;
- get;
- update;
- optimistic conflict;
- delete;
- another user cannot read;
- another user cannot update;
- manual file edit reflected;
- additional resources survive Save;
- provider invalidates after write.

### 24.3. DSH integration

Against target `0.1.5-rc.2`:

- personal Skill appears in `ctx.skills.list`/snapshot for proper QA scope;
- same Skill is absent from another user's QA scope;
- `/skill-name` works when `user-invocable`;
- model catalog honors `disable-model-invocation`;
- changing body does not require restart;
- rename/remove invalidates catalog;
- tool catalog uses current scope.

### 24.4. Tool permission tests

Given session tools:

```text
read, grep
```

and Skill `allowed-tools`:

```text
read, bash, jira_transition
```

UI:

```text
read            available
bash            unavailable
jira_transition unavailable
```

Effective runtime restriction, if enforcement stage enabled:

```text
read
```

No code path may turn unavailable declared tools into session-visible tools.

### 24.5. UI

- Settings opens;
- sections navigate;
- profile Save;
- catalog loading/error/empty;
- create;
- edit;
- dirty-state prompt;
- tool picker search;
- unknown tool rendering;
- validation;
- save;
- delete confirmation;
- keyboard navigation.

### 24.6. Security regression

- forged user id;
- forged cwd;
- `../../`;
- symlink to another user's directory;
- Skill directory replaced by symlink between validate/write;
- concurrent update;
- oversized file;
- malformed YAML.

---

## 25. Implementation phases

### Phase 0 — Repository spike

Before coding:

1. map current `dsh-qa-surface` Host/Web structure;
2. locate existing profile modal and profile storage;
3. locate user → personal cwd resolver;
4. identify current QA session scope identifier;
5. verify `ctx.skills` and `ctx.tools` availability in target plugin context;
6. write a tiny test/provider proving per-user Skill visibility on `0.1.5-rc.2`.

Deliverable:

```text
short implementation note / ADR
```

No production UI yet.

### Phase 1 — Unified Settings shell

- create Settings modal;
- sidebar;
- move Profile;
- add General placeholder/current settings;
- preserve profile behavior;
- replace old Profile modal entry point.

### Phase 2 — Personal Skill storage

- `PersonalSkillService`;
- safe root resolver;
- parse/serialize;
- validation;
- CRUD;
- revision conflict;
- tests.

### Phase 3 — `qa-user-skills` provider

- register provider;
- personal root mapping;
- list/get/load;
- invalidate;
- isolation tests;
- optional watcher.

### Phase 4 — Skills catalog/editor

- catalog page;
- search;
- create flow;
- editor;
- invocation flags;
- Markdown body;
- preview;
- validation messages.

### Phase 5 — Tool catalog & picker

- backend scope-aware `ctx.tools.schemas(...)`;
- tool DTO;
- picker;
- unknown tools;
- `allowed-tools` serializer/parser;
- tests.

### Phase 6 — Runtime tool restriction

Only if a reliable active-Skill lifecycle seam exists.

- intersection-only;
- never widen;
- scoped restriction;
- tests;
- clear UX wording.

If seam is not reliable, postpone this phase instead of emulating enforcement through prompts.

### Phase 7 — Hardening

- optimistic concurrency;
- manual edit handling;
- security tests;
- mobile/responsive;
- logging;
- accessibility;
- error recovery.

### Phase 8 — Resources (optional follow-up)

- references;
- assets;
- upload;
- browse;
- no executable scripts by default.

---

## 26. Suggested repository organization

Adapt names to the actual repository structure; responsibilities should remain separated.

Example:

```text
plugins/dsh-qa-surface/
├── src/
│   ├── host/
│   │   ├── profile/
│   │   ├── personal-skills/
│   │   │   ├── service.ts
│   │   │   ├── provider.ts
│   │   │   ├── paths.ts
│   │   │   ├── parser.ts
│   │   │   ├── serializer.ts
│   │   │   ├── validation.ts
│   │   │   └── tools.ts
│   │   └── ...
│   ├── shared/
│   │   ├── settings-contract.ts
│   │   ├── skills-contract.ts
│   │   └── validation-types.ts
│   └── web/
│       ├── settings/
│       │   ├── SettingsDialog.tsx
│       │   ├── SettingsSidebar.tsx
│       │   ├── ProfileSettingsPage.tsx
│       │   ├── GeneralSettingsPage.tsx
│       │   └── skills/
│       │       ├── SkillsSettingsPage.tsx
│       │       ├── SkillCatalog.tsx
│       │       ├── SkillEditor.tsx
│       │       ├── SkillToolPicker.tsx
│       │       └── SkillFilePreview.tsx
│       └── ...
└── tests/
    ├── personal-skills/
    └── settings/
```

Не создавать один огромный `skills.ts` одновременно для filesystem, DSH provider, API и UI state.

---

## 27. Non-goals v1

В первую версию не входят:

- публичный marketplace Skills;
- установка Skill из GitHub;
- sharing между пользователями;
- admin catalog management;
- автоматическая генерация Skill через LLM;
- execution/editing `scripts/`;
- arbitrary filesystem roots;
- выдача новых tool permissions через Skill;
- собственная альтернативная skill runtime вместо DSH;
- полноценный WYSIWYG Markdown IDE;
- version history UI.

Эти функции не должны мешать будущему расширению архитектуры.

---

## 28. Future extensions

После v1 архитектура должна позволять добавить:

### Import / Export

- ZIP;
- directory bundle;
- single `SKILL.md`.

### Skill templates

```text
API testing
Bug investigation
Jira investigation
Documentation review
Regression checklist
```

### Create with assistant

Пользователь описывает workflow, QA Surface создаёт draft Skill, но Save всегда остаётся явным действием пользователя.

### Shared organization Skills

Отдельный read-only provider:

```text
organization
```

с понятным precedence и ownership.

### Version history

- file revisions;
- restore;
- diff.

### Resources UI

- `references/`;
- `assets/`.

---

## 29. Acceptance criteria

Фича считается готовой, если выполняются все пункты:

1. Кнопка пользователя открывает одну общую Settings modal.
2. Профиль находится внутри неё и работает без потери существующих данных.
3. Есть раздел «Навыки».
4. Пользователь может создать Skill без ручного редактирования YAML.
5. Skill физически появляется как:
   ```text
   <personal-cwd>/.dsh/skills/<name>/SKILL.md
   ```
6. Skill автоматически появляется в DSH skill catalog текущего QA пользователя без restart.
7. Skill другого пользователя не виден.
8. Можно редактировать `name`, `description`, `whenToUse`, invocation flags и Markdown body.
9. Можно выбрать tools из актуального DSH tool registry.
10. Выбор сохраняется в `allowed-tools`.
11. Unknown tool не теряется при round-trip.
12. `allowed-tools` не может предоставить tool, которого нет в текущем QA scope.
13. Существующие неизвестные frontmatter fields не теряются при Save.
14. Есть validation и понятные diagnostics.
15. Запрещены traversal и symlink escape.
16. Concurrent edit не перезаписывается молча.
17. Create/Update/Delete корректно инвалидируют skill registry.
18. UI корректно работает в light/dark theme.
19. Есть unit + integration tests на user isolation.
20. Изменения не требуют patching upstream DSH.

---

## 30. Reference points to verify during implementation

Upstream DSH references:

```text
deepseek-ai/deepseek-harness/docs/subsystems/skills.md
deepseek-ai/deepseek-harness/packages/skill/skill/README.md
deepseek-ai/deepseek-harness/packages/skill/skill-filesystem/README.md
deepseek-ai/deepseek-harness/packages/core/tools/README.md
deepseek-ai/deepseek-harness/docs/tool-catalog.md
```

Agent Skills format:

```text
agentskills/agentskills/docs/specification.mdx
```

Important upstream behavior to preserve:

- DSH has a provider-based `ctx.skills` registry;
- filesystem Skills use `SKILL.md`;
- DSH local discovery includes project/user roots;
- project root may be resolved through nearest `.git`;
- `ctx.tools.schemas(scope)` exposes scope-visible tool schemas;
- `allowed-tools` in Agent Skills is experimental and represented canonically as a space-separated string;
- DSH filesystem discovery should not be assumed to enforce `allowed-tools` permissions.

---

## 31. Final implementation principle

The feature must behave as a **user-friendly management layer over native DSH Skills**, not as a second skill subsystem.

The desired chain is:

```text
Authenticated QA user
        │
        ▼
Personal cwd
        │
        └── .dsh/skills/<name>/SKILL.md
                    │
                    ▼
             qa-user-skills provider
                    │
                    ▼
               ctx.skills
                    │
            ┌───────┴────────┐
            ▼                ▼
      model discovery    /skill-name

Settings UI
    │
    ├── Profile
    ├── General
    └── Skills
          │
          ├── editor
          ├── tool picker
          ├── validation
          └── preview
```

Главные инварианты:

```text
portable files
user isolation
no permission widening
native DSH registry
no upstream patching
```
