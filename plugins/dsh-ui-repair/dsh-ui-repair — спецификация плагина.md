# dsh-ui-repair

## 1. Цель

Создать DeepSeek Harness plugin, который автоматически обнаруживает и исправляет визуальные и layout-проблемы Web UI других DSH-плагинов **без изменения их исходного кода**.

Плагин должен работать как compatibility/repair layer поверх существующего UI.

Основная идея:

```text
DSH Web UI
    │
    ├── Core UI
    ├── Plugin A
    ├── Plugin B
    ├── Plugin C
    │
    └── dsh-ui-repair
           │
           ├── DOM inspector
           ├── CSS/layout diagnostics
           ├── repair rules
           ├── CSS overrides
           ├── DOM observers
           ├── visual verification
           └── repair history
```

Плагин не должен форкать и переписывать сторонние плагины.

---

# 2. Основные задачи

MVP должен решать следующие классы проблем.

### 2.1 Alignment

Обнаруживать:

- иконки не выровнены относительно текста;
- иконки имеют разные размеры;
- vertical-align отличается;
- элементы имеют разные left/right offsets;
- одинаковые элементы находятся на разных X/Y;
- flex items имеют разные alignment;
- элементы визуально «прыгают» относительно соседей.

Пример:

```text
⚙ General
 ⚙ Models
    ⚙ Skills
       ⚙ Plugins
```

Должно обнаруживаться как:

```text
alignment-error:
  group: settings-menu-items
  property: icon-x
  expected: 60px
  actual:
    General: 60px
    Models: 59px
    Skills: 57px
    Plugins: 61px
```

Repair:

```css
.icon {
    width: 18px;
    min-width: 18px;
    display: inline-flex;
    justify-content: center;
}
```

---

# 3. Overflow / Scroll Repair

Одна из приоритетных функций.

Автоматически обнаруживать ситуации, когда содержимое выходит за пределы контейнера:

```text
Settings
│
├── General
├── Models
├── Skills
├── Plugins
├── ...
├── Web UI Plugins
└── Vision Router   ← частично/полностью обрезан
```

Диагностика должна проверять:

```js
element.scrollHeight > element.clientHeight
```

и:

```js
element.scrollWidth > element.clientWidth
```

при отсутствии подходящего overflow.

Возможный repair:

```css
.settings-container {
    overflow-y: auto;
    min-height: 0;
}
```

Но нельзя бездумно добавлять `overflow-y: auto`.

Сначала определить:

1. какой элемент является scroll container;
2. какой родитель ограничивает его высоту;
3. есть ли уже другой scroll container;
4. не ломает ли `overflow` sticky/fixed элементы;
5. не является ли clipping намеренным.

---

# 4. Размеры элементов

Обнаруживать:

- слишком маленькие clickable areas;
- разные размеры одинаковых иконок;
- разные размеры кнопок одного типа;
- элементы, выходящие за parent;
- элементы с `width/height: auto`, когда sibling-элементы имеют фиксированный размер;
- неожиданный `flex-shrink`;
- неожиданный `flex-grow`;
- элементы, сжатые из-за нехватки места.

Примеры repair:

```css
.plugin-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
}
```

или:

```css
.plugin-row {
    min-width: 0;
}
```

---

# 5. Spacing / Padding / Margin

Обнаруживать визуально неправильные:

- margin;
- padding;
- gap;
- row-gap;
- column-gap;
- расстояние между icon и label;
- расстояние между соседними rows;
- расстояние между section header и content.

Особенно важно обнаруживать аномалии относительно группы.

Например:

```text
General      icon → text = 8px
Models       icon → text = 8px
Skills       icon → text = 4px   ← anomaly
Plugins      icon → text = 8px
```

Repair должен нормализовать только аномальный элемент.

---

# 6. Typography

Обнаруживать:

- разные font-size;
- неправильный line-height;
- font-weight;
- text wrapping;
- label выходит за пределы;
- текст обрезается;
- `white-space` отличается от sibling;
- vertical alignment текста.

Пример:

```css
.settings-label {
    line-height: 20px;
    white-space: nowrap;
}
```

Не пытаться автоматически менять глобальный font-family без очень высокой уверенности.

---

# 7. Flex/Grid diagnostics

Плагин должен уметь анализировать layout родителей.

Для каждого проблемного элемента проверять:

```text
display
position
flex-direction
align-items
justify-content
gap
flex
flex-grow
flex-shrink
flex-basis
grid-template-columns
grid-template-rows
overflow
min-width
min-height
width
height
```

Особенно искать:

- `flex-shrink: 1`, вызывающий неожиданное сжатие;
- отсутствие `min-width: 0`;
- неправильный `align-items`;
- `justify-content`;
- конфликтующие `gap` и margin;
- grid columns неправильного размера.

---

# 8. Clipping diagnostics

Обнаруживать элементы, которые:

- частично находятся за пределами parent;
- перекрываются sibling;
- обрезаются через `overflow: hidden`;
- находятся под другим элементом;
- имеют неправильный `z-index`;
- выходят за viewport.

Для каждого элемента вычислять:

```text
boundingClientRect
parentRect
viewportRect
intersection
```

И выдавать:

```text
CLIPPED
element: Vision Router
visible: 82%
parent: Settings scroll container
reason: parent overflow:hidden
```

---

# 9. Position diagnostics

Обнаруживать:

- `position: absolute` с неправильным anchor;
- `fixed` элементы, закрывающие UI;
- элементы, смещённые относительно sibling group;
- неправильные top/left/right/bottom;
- negative margins;
- transform translate, вызывающий визуальный offset.

---

# 10. Z-index diagnostics

Проверять потенциальные проблемы:

```text
element A
z-index: 1

element B
z-index: 10

A visually expected above B
```

Выявлять:

- перекрытие;
- invisible click target;
- dropdown под modal;
- tooltip под panel;
- popup за sidebar.

Repair должен быть осторожным.

Не назначать огромный:

```css
z-index: 999999;
```

без необходимости.

Использовать минимально необходимое значение.

---

# 11. Responsive diagnostics

Плагин должен уметь проверять UI в нескольких viewport:

```text
1280 × 720
1440 × 900
1920 × 1080
```

Опционально:

```text
1024 × 768
768 × 1024
```

И находить проблемы, которые возникают только при определённой ширине:

- overflow;
- text wrapping;
- disappearing buttons;
- compressed sidebar;
- broken grid;
- horizontal scrollbar;
- clipped panels.

---

# 12. DOM-based repair engine

Создать собственный repair engine.

У каждого repair должна быть структура примерно такого типа:

```ts
interface UIRepair {
    id: string
    plugin?: string
    selector: string

    diagnosis: {
        type: string
        confidence: number
        evidence: unknown
    }

    changes: {
        css?: Record<string, string>
        attributes?: Record<string, string>
        classes?: string[]
    }

    scope: {
        root: string
    }

    priority: number

    reversible: boolean
}
```

Каждый repair должен быть:

- scoped;
- reversible;
- identifiable;
- logged;
- disable-able.

---

# 13. Не менять source code сторонних плагинов

Критически важно:

**НЕ делать:**

```text
modify plugin source
patch node_modules
rewrite installed package
```

Вместо этого:

```text
plugin source
     ↓
runtime
     ↓
dsh-ui-repair
     ↓
scoped CSS/DOM overlay
```

После удаления `dsh-ui-repair` исходный UI должен вернуться в исходное состояние.

---

# 14. Scoped CSS

Все автоматически созданные CSS overrides должны быть изолированы.

Например:

```css
[data-dsh-ui-repair="settings-icon-alignment"] .plugin-icon {
    width: 18px;
    height: 18px;
}
```

Не создавать глобальные правила типа:

```css
svg {
    width: 18px;
}
```

или:

```css
* {
    overflow: visible;
}
```

Глобальные изменения запрещены в auto mode.

---

# 15. Plugin targeting

Плагин должен уметь определять источник UI.

Желательная схема:

```text
plugin:
    id
    package
    version
    root element
```

Если прямой информации о владельце DOM-node нет, использовать эвристику:

- ближайший plugin root;
- data attributes;
- DOM hierarchy;
- known plugin selectors;
- registered plugin metadata.

Не делать repair по одному только CSS class name, если есть риск совпадения с другим компонентом.

---

# 16. Repair modes

Должно быть три режима.

## Mode A — Observe

Ничего не менять.

Только:

```text
scan
→ diagnostics
→ report
```

Пример:

```text
Found 7 UI issues

HIGH
  Settings panel has 114px clipped content

MEDIUM
  4 icons have inconsistent horizontal alignment

LOW
  Skills row has 4px different icon gap
```

---

## Mode B — Suggest

Плагин предлагает fixes, но не применяет автоматически.

```text
Issue:
  settings-scroll

Suggested fix:
  overflow-y: auto

Confidence:
  97%

[Apply] [Ignore] [Always apply]
```

---

## Mode C — Auto

Автоматически применяет только repairs выше confidence threshold.

Например:

```text
confidence >= 0.95
```

Для опасных изменений:

```text
z-index
position
display
overflow
```

требовать более высокий threshold, например:

```text
>= 0.98
```

---

# 17. Confidence system

Каждый repair должен иметь confidence score.

Пример:

```text
icon alignment
  +0.35 same parent
  +0.25 same semantic role
  +0.20 same dimensions
  +0.15 repeated pattern
  +0.05 visual confirmation

confidence = 1.00
```

Нельзя автоматически применять сомнительные изменения.

---

# 18. Visual verification

После применения repair:

```text
DOM diagnosis
      ↓
apply repair
      ↓
wait for layout stabilization
      ↓
screenshot
      ↓
visual comparison
      ↓
accept / rollback
```

Для этого интегрироваться с `dsh-vision-toolkit`, если он установлен.

У него уже есть `vision_html_screenshot` и `vision_pixel_diff`, а UI-restoration workflow использует именно цикл render → diff → fix → render.

Если toolkit отсутствует, основной DOM/CSS режим должен продолжать работать без него.

---

# 19. Layout stabilization

После изменения DOM/CSS нельзя сразу считать repair успешным.

Нужно дождаться стабилизации layout.

Алгоритм:

```text
screenshot/layout snapshot #1
        ↓
requestAnimationFrame
        ↓
snapshot #2
        ↓
если geometry отличается
    повторить
        ↓
если geometry стабильна
    verify
```

Не использовать просто:

```js
setTimeout(..., 1000)
```

как единственный механизм ожидания.

---

# 20. Automatic rollback

Каждый repair должен иметь rollback.

Пример:

```text
Before:
    scrollHeight = 1240
    clientHeight = 720
    horizontal overflow = false

Apply:
    overflow-y: auto

After:
    scrollHeight = 1240
    clientHeight = 720
    scrollbar visible
    horizontal overflow = false

→ SUCCESS
```

Если после repair:

```text
horizontal overflow = true
```

или появились новые clipping errors:

```text
→ ROLLBACK
```

---

# 21. Repair history

Хранить историю:

```text
repair id
timestamp
plugin
selector
diagnosis
before
change
after
verification
rollback
```

Пример:

```text
2026-08-24 16:52

Plugin: example-settings
Repair: settings-scroll
Selector: .settings-menu

Before:
  content clipped: 124px

Applied:
  overflow-y: auto

After:
  content clipped: 0px

Visual diff:
  improved

Status:
  SUCCESS
```

---

# 22. Ignore rules

Пользователь должен иметь возможность сказать:

```text
ignore this issue
```

или:

```text
ignore selector
```

или:

```text
ignore plugin
```

Пример config:

```yaml
uiRepair:
  ignore:
    - plugin: some-plugin
      rule: icon-alignment

    - selector: ".intentional-overflow"
```

---

# 23. Persistent fixes

Пользователь должен иметь возможность сохранить исправление.

```text
Temporary
Persistent
```

Persistent repair переживает:

- reload;
- restart DSH;
- plugin reload.

Но должен оставаться отдельным от исходного plugin package.

---

# 24. Plugin update compatibility

После обновления стороннего плагина:

```text
old repair
      ↓
plugin version changed
      ↓
revalidate repair
      ↓
if selector still valid → keep
if changed → disable + report
```

Нельзя молча применять старый repair к полностью изменившемуся DOM.

---

# 25. Web UI Settings

Добавить собственную Settings page:

```text
UI Repair

Status
  ● Active

Mode
  [Observe / Suggest / Auto]

Auto confidence
  [95%]

Visual verification
  [On]

Scan on startup
  [On]

Scan after plugin load
  [On]

Scan after plugin update
  [On]
```

---

# 26. Diagnostics page

Показывать:

```text
UI Health

7 issues found
3 repaired
2 ignored
2 unresolved
```

Категории:

```text
Alignment
Overflow
Spacing
Typography
Clipping
Position
Z-index
Responsive
```

---

# 27. Per-plugin view

Например:

```text
Plugin: example-settings

Health: 82/100

Issues:

✓ Icon alignment
  Fixed

✓ Row spacing
  Fixed

⚠ Settings overflow
  Suggested fix

✕ Unknown z-index conflict
  Unresolved
```

---

# 28. Repair preview

Перед применением Suggest repair должен уметь показать:

```text
Before screenshot
        ↓
After screenshot
        ↓
difference / affected region
```

Для визуальных проверок использовать screenshot/diff tooling, если доступно.

---

# 29. Manual repair API

Добавить возможность вручную зарегистрировать repair:

```ts
uiRepair.register({
    id: 'fix-example-settings-scroll',

    selector: '.settings-panel',

    when: ({ element }) =>
        element.scrollHeight > element.clientHeight,

    apply: ({ element }) => {
        element.style.overflowY = 'auto'
    },

    rollback: ({ element, previous }) => {
        ...
    }
})
```

Это позволит другим DSH-плагинам поставлять собственные compatibility rules.

---

# 30. Rule API

Создать публичный API:

```ts
uiRepair.rules.register(...)
uiRepair.rules.unregister(...)
uiRepair.rules.list(...)
```

Другой plugin сможет сказать:

```ts
uiRepair.rules.register({
    plugin: 'my-plugin',
    rule: {
        id: 'sidebar-overflow',
        ...
    }
})
```

---

# 31. MutationObserver

Плагин должен следить за динамическим UI.

Использовать:

```js
MutationObserver
```

для:

- новых DOM nodes;
- удаления nodes;
- изменения class;
- изменения attributes.

Но observer нельзя запускать как бесконечный full-tree scan.

Нужно:

```text
mutation
    ↓
collect affected roots
    ↓
debounce
    ↓
targeted scan
```

---

# 32. ResizeObserver

Использовать:

```js
ResizeObserver
```

для элементов, чья geometry меняется после:

- загрузки;
- раскрытия меню;
- изменения viewport;
- загрузки шрифтов;
- plugin initialization.

---

# 33. Performance

Очень важно не превратить DSH в лагучее приложение.

Запрещено:

```text
каждая DOM mutation
→ scan entire document
→ getBoundingClientRect() для всего дерева
```

Нужно:

```text
mutation
→ identify affected subtree
→ schedule scan
→ batch geometry reads
→ batch writes
```

Использовать `requestAnimationFrame` / debounce.

---

# 34. Safe CSS writes

Не смешивать чтение и запись layout в цикле:

Плохо:

```js
for (...) {
    element.style.width = ...
    element.getBoundingClientRect()
}
```

Предпочтительно:

```text
READ phase
  collect geometry

CALCULATE phase
  calculate repairs

WRITE phase
  apply CSS

VERIFY phase
  remeasure
```

---

# 35. Built-in rules для MVP

Первая версия должна содержать минимум эти rules:

```text
R001 icon-alignment
R002 icon-size-consistency
R003 row-horizontal-alignment
R004 row-vertical-alignment
R005 unexpected-overflow-x
R006 unexpected-overflow-y
R007 clipped-content
R008 flex-shrink-anomaly
R009 missing-min-width-zero
R010 inconsistent-gap
R011 inconsistent-padding
R012 text-overflow
R013 element-outside-parent
R014 hidden-click-target
R015 z-index-overlap
```

---

# 36. Приоритет реализации

## P0 — обязательно

Сделать:

1. plugin skeleton;
2. Web UI integration;
3. DOM scanner;
4. geometry diagnostics;
5. CSS repair layer;
6. scoped selectors;
7. rollback;
8. Observe/Suggest/Auto modes;
9. overflow detection;
10. icon alignment detection;
11. clipping detection;
12. persistent config;
13. repair logs;
14. tests.

---

## P1

Добавить:

1. MutationObserver;
2. ResizeObserver;
3. plugin attribution;
4. repair confidence;
5. plugin-specific rules;
6. diagnostics UI;
7. per-plugin health;
8. responsive scanning;
9. automatic rollback;
10. visual verification.

---

## P2

Добавить:

1. integration с dsh-vision-toolkit;
2. screenshot before/after;
3. pixel diff;
4. visual repair suggestions;
5. AI-assisted diagnosis;
6. AI-generated CSS patch;
7. repair preview;
8. automatic visual convergence.

---

# 37. AI-assisted repair

Это не должно быть обязательным для MVP.

В будущем:

```text
DOM diagnostics
      +
screenshot
      ↓
Vision / Agent
      ↓
"Icon group has inconsistent x-position"
      ↓
generate repair
      ↓
sandbox apply
      ↓
screenshot
      ↓
pixel diff
      ↓
accept / reject
```

AI должен **предлагать изменение**, а не иметь unrestricted access к DOM/CSS.

---

# 38. Safety rules

Автоматический режим НЕ должен без подтверждения:

- менять `position: fixed` на `absolute`;
- удалять DOM nodes;
- менять text/content;
- менять accessibility attributes;
- менять event handlers;
- менять routing;
- менять navigation;
- менять global CSS;
- удалять пользовательские styles;
- менять plugin source;
- менять package files.

Auto mode должен заниматься прежде всего:

```text
layout
spacing
alignment
overflow
dimensions
visual stacking
```

---

# 39. Accessibility

Repair не должен ухудшать:

- keyboard navigation;
- focus;
- ARIA;
- screen reader semantics;
- tab order;
- clickable area.

После repair проверять хотя бы:

```text
tabIndex
aria-*
role
focusability
```

Если repair потенциально меняет accessibility — confidence снижать или требовать manual approval.

---

# 40. Testing

Нужны unit tests:

```text
icon alignment
overflow
clipping
spacing
flex shrink
z-index
rollback
scoping
confidence
ignore rules
```

Нужны integration tests:

```text
plugin loaded
→ repair plugin activated
→ target plugin loaded
→ issue detected
→ repair applied
→ target plugin still functional
```

Нужны regression fixtures.

Создать несколько искусственных UI:

```text
fixtures/
    misaligned-icons/
    broken-scroll/
    clipped-panel/
    flex-shrink/
    z-index/
    mixed-spacing/
```

Для каждого:

```text
before
expected diagnosis
expected repair
after
rollback
```

---

# 41. Visual regression

Для P1/P2 использовать screenshot-based tests.

Принцип:

```text
fixture
    ↓
render
    ↓
screenshot
    ↓
repair
    ↓
screenshot
    ↓
diff
```

Не требовать абсолютного `0%` pixel diff в общем случае.

Считать успешным repair, если:

1. конкретная проблема исчезла;
2. не появились новые проблемы;
3. layout стал стабильным;
4. визуальная разница не ухудшилась существенно.

Это важно, потому что pixel diff является инструментом локализации изменений, а не универсальным критерием «идеального UI».

---

# 42. Definition of Done для MVP

Плагин считается готовым, если он способен на реальном DSH Web:

### Case 1 — Icons

Имеется:

```text
⚙ General
  ⚙ Models
 ⚙ Skills
    ⚙ Plugins
```

Плагин:

```text
detect
→ classify as alignment anomaly
→ calculate expected alignment
→ generate scoped CSS
→ apply
→ verify
```

После repair:

```text
⚙ General
⚙ Models
⚙ Skills
⚙ Plugins
```

---

### Case 2 — Settings scroll

Есть panel:

```text
Settings
...
Web UI Plugins
Vision Router
```

где последние элементы выходят за viewport.

Плагин:

```text
detect:
  scrollHeight > clientHeight

find:
  nearest safe scroll container

repair:
  overflow-y: auto

verify:
  all content reachable
  no horizontal overflow
  no layout regression
```

---

### Case 3 — Rollback

После repair искусственно создать regression.

Плагин должен:

```text
detect regression
→ rollback
→ restore previous CSS
→ report failure
```

---

### Case 4 — Third-party isolation

После удаления `dsh-ui-repair`:

```text
all original plugin behavior restored
```

Никаких изменений в:

```text
node_modules
plugin source
package files
```

---

# 43. Что агент должен сделать первым

Не начинать сразу писать repair engine.

Сначала:

```text
1. Изучить актуальный DeepSeek Harness repository.
2. Изучить Web UI plugin lifecycle.
3. Найти способ безопасно монтировать client-side code.
4. Найти существующие DOM/CSS extension points.
5. Найти, как plugin может определить другие plugin roots.
6. Проверить, какие API Cordis предоставляет для lifecycle/unload.
7. Проверить, как устроены Settings pages.
8. Проверить возможность MutationObserver/ResizeObserver.
9. Создать минимальный proof-of-concept.
10. Только после этого проектировать production API.
```

Это особенно важно, потому что DSH сейчас находится в developer preview и сам проект предупреждает о возможных compatibility-breaking changes.

---

# 44. Первый Proof of Concept

До полноценного плагина сделать минимальный эксперимент:

```text
dsh-ui-repair
    ↓
find .settings-panel
    ↓
measure scrollHeight/clientHeight
    ↓
detect overflow
    ↓
inject scoped CSS
    ↓
verify
```

И второй:

```text
find settings rows
    ↓
find icons
    ↓
measure icon bounding boxes
    ↓
calculate X positions
    ↓
detect outlier
    ↓
apply alignment fix
```

Если оба POC работают на реальном DSH Web без изменения исходных файлов других плагинов — переходить к полноценной архитектуре.

---

# 45. Ожидаемая структура проекта

Предлагаемая структура:

```text
dsh-ui-repair/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── lifecycle.ts
│   ├── scanner/
│   │   ├── dom.ts
│   │   ├── geometry.ts
│   │   ├── overflow.ts
│   │   ├── alignment.ts
│   │   ├── clipping.ts
│   │   ├── spacing.ts
│   │   └── stacking.ts
│   │
│   ├── repair/
│   │   ├── engine.ts
│   │   ├── css.ts
│   │   ├── rollback.ts
│   │   ├── confidence.ts
│   │   └── history.ts
│   │
│   ├── rules/
│   │   ├── alignment.ts
│   │   ├── overflow.ts
│   │   ├── clipping.ts
│   │   ├── spacing.ts
│   │   ├── flex.ts
│   │   └── zindex.ts
│   │
│   ├── observers/
│   │   ├── mutation.ts
│   │   └── resize.ts
│   │
│   ├── plugins/
│   │   ├── attribution.ts
│   │   └── registry.ts
│   │
│   ├── visual/
│   │   ├── screenshot.ts
│   │   └── diff.ts
│   │
│   └── web/
│       ├── settings.ts
│       ├── diagnostics.ts
│       └── repairs.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/
│   └── visual/
│
└── docs/
    ├── architecture.md
    ├── rules.md
    └── plugin-api.md
```

---

# 46. Главный принцип проекта

Главное — **не делать "AI, который хаотично правит CSS"**.

Правильная архитектура:

```text
OBSERVE
   ↓
DIAGNOSE
   ↓
MEASURE
   ↓
PROPOSE
   ↓
SCOPE
   ↓
APPLY
   ↓
VERIFY
   ↓
KEEP / ROLLBACK
```

То есть AI/Vision в будущем может помогать с `DIAGNOSE` и `PROPOSE`, но фундаментом должны быть детерминированные DOM/CSS измерения и обратимые изменения.

Это позволит сделать `dsh-ui-repair` не одноразовым костылём под твои два скриншота, а **универсальным compatibility layer для кривых сторонних DSH-плагинов**.