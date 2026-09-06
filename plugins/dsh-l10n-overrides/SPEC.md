# dsh-l10n-overrides

## 1. Summary

`dsh-l10n-overrides` — client-side plugin для DeepSeek Harness, позволяющий добавлять и переопределять английские переводы UI сторонних DSH-плагинов **без форков и изменений их исходного кода**.

Основной сценарий:

- установлен сторонний DSH plugin;
- его интерфейс полностью или частично на китайском;
- upstream plugin продолжает обновляться независимо;
- `dsh-l10n-overrides` содержит отдельный translation pack;
- при выборе английского языка DSH пользователь видит английские строки.

Плагин должен поддерживать два механизма:

1. **Locale overrides** — основной и предпочтительный способ.
2. **DOM overrides** — fallback для hardcoded UI-строк, которые не используют DSH locale API.

Никакие файлы target plugin не должны патчиться на диске.

---

# 2. Goals

## Основные цели

Реализовать возможность создавать translation packs вида:

```text
Target plugin
    ↓
dsh-l10n-overrides
    ↓
English UI
```

Без:

- fork target repository;
- patch-package;
- изменения `node_modules` target plugin;
- postinstall patch;
- копирования полного исходного plugin;
- необходимости ждать поддержки английского от upstream.

Translation pack должен содержать только данные и минимальные selectors для DOM fallback.

---

# 3. Non-goals

В первой версии НЕ требуется:

- добавлять новые locale IDs в DSH;
- заменять штатный language selector;
- делать машинный перевод через LLM/API;
- автоматически переводить неизвестный китайский текст;
- модифицировать bundle стороннего plugin;
- monkey-patch React;
- перехватывать network requests;
- поддерживать server-side/model translations;
- делать универсальную систему локализации самого DeepSeek Harness.

Версия `v0.1` ориентирована на:

```text
zh/original UI → en override
```

Архитектура при этом должна позволять позже добавить другие языки.

---

# 4. Package name

NPM/package name:

```text
dsh-l10n-overrides
```

Repository name:

```text
dsh-l10n-overrides
```

Plugin log prefix:

```text
[dsh-l10n-overrides]
```

---

# 5. High-level architecture

```text
DeepSeek Harness
│
├── LocaleRuntime
│      │
│      ├── register()
│      ├── bind()
│      └── translate()
│
├── Third-party plugin A
│      └── t("settings.title")
│
├── Third-party plugin B
│      └── hardcoded "设置"
│
└── dsh-l10n-overrides
       │
       ├── TranslationPackRegistry
       │
       ├── LocaleHook
       │      └── wrap LocaleRuntime.translate()
       │
       ├── DomTranslator
       │      └── MutationObserver
       │
       └── packs/
              ├── plugin-a.ts
              ├── plugin-b.ts
              └── ...
```

---

# 6. Critical design rule

НЕЛЬЗЯ пытаться регистрировать второй словарь:

```text
(namespace, locale)
```

через обычный:

```ts
locale.register(...)
```

если namespace уже принадлежит target plugin.

Translation plugin должен работать **поверх lookup path**, а не конкурировать за ownership namespace.

Основной механизм:

```text
original locale.translate
        ↓
wrapped translate
        ↓
override registry lookup
   ├── found → translated value
   └── miss  → original translate()
```

---

# 7. Runtime integration

Plugin является обычным browser/client DSH plugin.

Минимальные client dependencies:

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  }
}
```

Точный dependency set необходимо сверить с текущей версией DSH при реализации.

Не добавлять Host plugin без необходимости.

---

# 8. Locale hook

## 8.1 Principle

После появления:

```ts
ctx.locale
```

сохранить оригинальную функцию `translate` и установить wrapper.

Пример логики:

```ts
const locale = ctx.locale as PatchableLocaleRuntime

const originalTranslate = locale.translate

function patchedTranslate(
  namespace: string,
  key: string,
  params?: Record<string, unknown>,
): string {
  const activeLocale = locale.getSnapshot().active

  const override = registry.resolve(
    activeLocale,
    namespace,
    key,
  )

  if (override !== undefined) {
    return interpolate(override, params)
  }

  return originalTranslate.call(
    locale,
    namespace,
    key,
    params,
  )
}

locale.translate = patchedTranslate
```

Реальный код должен:

- сохранять корректный `this`;
- корректно восстанавливаться при dispose;
- не устанавливать wrapper дважды;
- не зависеть от private TypeScript declarations;
- изолировать unsafe cast в одном adapter-файле.

---

# 9. Important DSH behavior

В текущем DSH `bind(namespace)` создаёт стабильную функцию, концептуально работающую как:

```ts
(key, params) => this.translate(namespace, key, params)
```

Это означает, что `translate()` можно wrapped после того, как другой plugin уже получил bound translator.

То есть этот сценарий должен работать:

```text
Plugin A starts
↓
const t = locale.bind("plugin-a")
↓
dsh-l10n-overrides starts
↓
locale.translate gets patched
↓
t("foo")
↓
patched translate()
```

Добавить unit test специально на данный сценарий.

---

# 10. TranslationPack API

Каждый target plugin получает отдельный translation pack.

Предлагаемая структура:

```ts
export interface TranslationPack {
  id: string

  target: {
    package: string
    versions?: string
  }

  locales: Partial<
    Record<
      string,
      Record<string, Record<string, string>>
    >
  >

  dom?: DomTranslationRule[]

  metadata?: {
    sourceLanguage?: string
    description?: string
    upstream?: string
  }
}
```

Для `v0.1` можно сделать более строгий API:

```ts
export interface TranslationPack {
  id: string

  target: {
    package: string
    versions?: string
  }

  en: Record<string, Record<string, string>>

  dom?: DomTranslationRule[]
}
```

Где:

```text
en
└── namespace
     └── key
          └── translation
```

---

# 11. Example translation pack

```ts
import type { TranslationPack } from '../types'

export default {
  id: 'example-plugin-en',

  target: {
    package: 'dsh-example-plugin',
    versions: '>=0.4.0 <1.0.0',
  },

  en: {
    'example.settings': {
      title: 'Settings',
      enabled: 'Enabled',
      server: 'Server address',
      save: 'Save',
    },

    'example.sidebar': {
      history: 'History',
      refresh: 'Refresh',
      delete: 'Delete',
    },
  },

  dom: [
    {
      scope: '[data-plugin="example-plugin"]',
      source: '设置',
      target: 'Settings',
    },
  ],
} satisfies TranslationPack
```

---

# 12. Pack registry

Создать:

```text
TranslationPackRegistry
```

Ответственность:

- принимать translation packs;
- нормализовать их;
- искать override;
- обнаруживать конфликты;
- предоставлять DOM rules;
- собирать diagnostics.

API ориентировочно:

```ts
interface TranslationRegistry {
  register(pack: TranslationPack): void

  resolve(
    locale: string,
    namespace: string,
    key: string,
  ): string | undefined

  getDomRules(
    locale: string,
  ): readonly DomTranslationRule[]

  getDiagnostics(): RegistryDiagnostics
}
```

---

# 13. Translation lookup priority

Для locale API:

```text
1. exact override:
   active locale + namespace + key

2. original DSH LocaleRuntime.translate()
```

Не реализовывать собственный fallback на китайский.

Fallback остаётся ответственностью оригинального `LocaleRuntime`.

Например:

```text
active=en

plugin.settings/title
        ↓
override exists?
   YES → "Settings"
   NO  → original DSH translate()
```

---

# 14. Interpolation

Override strings должны поддерживать тот же базовый формат parameters, что DSH:

```text
Hello, {name}
```

Например:

```ts
translate(
  'foo',
  'hello',
  { name: 'Alice' },
)
```

Результат:

```text
Hello, Alice
```

Utility:

```ts
function interpolate(
  template: string,
  params?: Record<string, unknown>,
): string
```

Поведение:

- неизвестный placeholder оставить как есть;
- `null`/`undefined` не должны ломать функцию;
- не выполнять eval;
- только простые `{name}` replacements.

---

# 15. Collision handling

Если два pack определяют:

```text
locale=en
namespace=foo.settings
key=save
```

должна появляться diagnostic error.

Не использовать порядок импорта как скрытый механизм priority.

На `v0.1`:

```text
duplicate override = error
```

Например:

```text
[dsh-l10n-overrides] duplicate translation override:
locale=en
namespace=foo.settings
key=save
packs=foo-base, foo-extra
```

Plugin при этом желательно не должен ронять весь DSH UI.

Рекомендуемое production behavior:

- log error;
- первый зарегистрированный override остаётся активным.

Tests должны гарантировать deterministic behavior.

---

# 16. DOM fallback

Некоторые plugins могут содержать строки прямо в JSX:

```tsx
<Button>设置</Button>
```

В таком случае `LocaleRuntime` вообще не участвует.

Для таких элементов реализовать:

```text
DomTranslator
```

на основе:

```text
MutationObserver
```

---

# 17. DOM rule format

```ts
interface DomTranslationRule {
  source: string
  target: string

  scope: string

  mode?: 'exact'

  attributes?: Array<
    'placeholder'
    | 'title'
    | 'aria-label'
    | 'alt'
  >
}
```

В `v0.1` поддерживается только:

```text
mode = exact
```

Regex и fuzzy matching НЕ нужны.

---

# 18. Scope is mandatory

DOM translation rule должен иметь CSS scope.

Плохой вариант:

```ts
{
  source: '删除',
  target: 'Delete'
}
```

Хороший:

```ts
{
  scope: '[data-plugin="foo"]',
  source: '删除',
  target: 'Delete'
}
```

Если target plugin не предоставляет стабильный root selector, разрешить явно:

```ts
scope: 'global'
```

Но это должно считаться unsafe mode и выводить warning.

---

# 19. DOM safety

DomTranslator НИКОГДА не должен изменять пользовательский/model-generated контент.

Минимальный denylist:

```text
input
textarea
pre
code
kbd
samp
script
style
[contenteditable]
[data-no-translate]
```

Также необходимо избегать:

- conversation messages;
- Markdown rendering;
- code blocks;
- terminal;
- editor;
- textareas;
- prompt editor;
- user inputs.

Если DSH имеет стабильные selectors для conversation/editor surfaces, добавить их в denylist.

---

# 20. DOM translation behavior

Для text node:

```html
<button>设置</button>
```

rule:

```ts
{
  source: '设置',
  target: 'Settings',
  scope: '.plugin-foo'
}
```

результат:

```html
<button>Settings</button>
```

Только exact trimmed matching.

Не делать:

```ts
text.replace('设置', 'Settings')
```

в произвольных предложениях.

---

# 21. Attribute translation

Опционально поддержать:

```html
<input placeholder="请输入名称">
```

через:

```ts
{
  scope: '.plugin-foo',
  source: '请输入名称',
  target: 'Enter a name',
  attributes: ['placeholder'],
}
```

Whitelist attributes:

```text
placeholder
title
aria-label
alt
```

Не изменять:

```text
value
href
src
class
id
data-*
```

---

# 22. MutationObserver requirements

Observer:

```ts
new MutationObserver(...)
```

должен следить минимум за:

```text
childList: true
subtree: true
characterData: true
```

Для attributes — только если существует хотя бы один attribute translation rule.

Не сканировать весь `document.body` после каждой mutation.

Алгоритм:

```text
initial:
    scan relevant scopes once

mutation:
    inspect changed node
    ↓
    inspect descendants only
    ↓
    apply matching rules
```

---

# 23. Performance requirements

DOM fallback не должен заметно влиять на UI.

Требования:

- никаких polling timers;
- никаких `setInterval`;
- никаких full-body rescans на mutation;
- mutation batch обрабатывать за один callback/microtask;
- rules индексировать;
- для exact text translation использовать Map;
- selectors кэшировать там, где это безопасно.

Пример индекса:

```ts
Map<
  scope,
  Map<sourceText, DomTranslationRule>
>
```

---

# 24. Locale switching

Когда active locale:

```text
en
```

применяются английские overrides.

При:

```text
zh
```

Locale hook обязан полностью делегировать translation оригинальному DSH.

DOM translator также должен учитывать active locale.

На:

```text
locale/change
```

нужно:

1. обновить active locale;
2. при переходе на `en` просканировать target scopes;
3. при уходе с `en` не продолжать переводить новые DOM nodes.

Полное восстановление уже изменённого DOM при переключении обратно на `zh` желательно, но может быть P1.

---

# 25. DOM restoration

Если реализация не слишком усложняется, сохранять оригинальное значение через:

```ts
WeakMap<Node, OriginalTranslationState>
```

Чтобы:

```text
zh → en → zh
```

могло восстановить исходную строку.

То же самое для translated attributes.

Если reliable restoration невозможно, не строить сложную систему ради `v0.1`.

В таком случае:

- disconnect observer;
- новые nodes больше не переводить;
- документировать ограничение.

Locale API overrides при этом обязаны корректно переключаться без reload.

---

# 26. Lifecycle/disposal

Plugin должен корректно поддерживать unload/dispose.

При dispose:

```text
1. MutationObserver.disconnect()
2. unsubscribe locale/change
3. restore original locale.translate
4. clear references
```

Восстанавливать `translate` только если текущая функция всё ещё является нашей wrapper-функцией.

Например:

```ts
if (locale.translate === patchedTranslate) {
  locale.translate = originalTranslate
}
```

Это важно, чтобы не стереть wrapper другого plugin.

---

# 27. Monkey-patch isolation

Все знания о внутреннем `LocaleRuntime.translate` должны находиться в одном файле:

```text
src/client/adapters/dsh-locale-runtime.ts
```

Например:

```ts
export interface PatchableLocaleRuntime {
  translate(
    namespace: string,
    key: string,
    params?: Record<string, unknown>,
  ): string

  getSnapshot(): {
    active: string
    revision: number
  }
}
```

Остальной plugin не должен делать:

```ts
as any
```

на `ctx.locale`.

Если DSH поменяет LocaleRuntime, чиниться должен преимущественно этот adapter.

---

# 28. Proposed project structure

```text
dsh-l10n-overrides/
│
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
│
├── src/
│   ├── client.ts
│   │
│   ├── types.ts
│   │
│   ├── registry/
│   │   ├── translation-registry.ts
│   │   └── diagnostics.ts
│   │
│   ├── runtime/
│   │   ├── locale-hook.ts
│   │   ├── interpolate.ts
│   │   └── dom-translator.ts
│   │
│   ├── adapters/
│   │   └── dsh-locale-runtime.ts
│   │
│   └── packs/
│       ├── index.ts
│       └── example.ts
│
└── tests/
    ├── registry.test.ts
    ├── locale-hook.test.ts
    ├── interpolation.test.ts
    └── dom-translator.test.ts
```

Подстроить layout под conventions актуальных DSH client plugins.

---

# 29. Packs index

Translation packs должны подключаться централизованно:

```ts
import example from './example'
import foo from './foo'
import bar from './bar'

export const translationPacks = [
  example,
  foo,
  bar,
] satisfies TranslationPack[]
```

Чтобы добавление нового plugin выглядело как:

```text
1. создать packs/plugin-name.ts
2. добавить import в packs/index.ts
3. добавить tests
```

Никаких изменений runtime для нового target plugin.

---

# 30. Version metadata

Каждый pack должен иметь:

```ts
target: {
  package: 'some-plugin',
  versions: '>=0.4.0 <0.7.0',
}
```

Это metadata о версиях, на которых translation pack протестирован.

Если runtime DSH позволяет безопасно получить список client plugins и их versions, добавить diagnostics:

```text
[dsh-l10n-overrides] some-plugin@0.8.0 is outside tested range >=0.4.0 <0.7.0
```

Но:

```text
version mismatch MUST NOT disable translations
```

Если reliable API получения version нет — оставить metadata без runtime check.

Не использовать undocumented internals только ради проверки version.

---

# 31. Diagnostics

В dev/debug console выводить:

```text
[dsh-l10n-overrides] loaded 3 translation packs
[dsh-l10n-overrides] 74 locale overrides registered
[dsh-l10n-overrides] 12 DOM rules registered
```

При проблеме:

```text
[dsh-l10n-overrides] duplicate override:
foo.settings/save
```

При unsafe global DOM rule:

```text
[dsh-l10n-overrides] pack "foo" contains global DOM translation rules
```

Не спамить console на каждый успешный lookup.

---

# 32. Debug mode

Предусмотреть compile/config boolean:

```ts
debug?: boolean
```

В debug mode разрешается вывод:

```text
locale override hit:
namespace=foo.settings
key=save
pack=foo-en
```

По умолчанию:

```text
debug = false
```

---

# 33. No translation guessing

Если override отсутствует:

```text
return originalTranslate(...)
```

Если DOM rule отсутствует:

```text
leave node untouched
```

Никакого:

- automatic Chinese detection;
- transliteration;
- external translator;
- LLM;
- dictionary guessing.

Все переводы должны быть explicitly declared.

---

# 34. React compatibility

Plugin не должен:

- patch `React.createElement`;
- patch JSX runtime;
- monkey-patch React reconciliation;
- хранить ReactNode;
- вмешиваться в component props target plugin.

Locale path и DOM path должны оставаться независимыми от React implementation.

---

# 35. Translation pack authoring workflow

Для добавления нового target plugin:

## Step 1

Открыть plugin UI с locale:

```text
English
```

## Step 2

Определить, какие строки проходят через LocaleRuntime.

Желательно посмотреть target plugin source:

```text
locale.register(...)
locale.bind(...)
t(...)
```

## Step 3

Добавить locale keys:

```ts
en: {
  'plugin.namespace': {
    foo: 'English text',
  },
}
```

## Step 4

Hardcoded JSX/UI строки добавить через DOM fallback:

```ts
dom: [
  {
    scope: '...',
    source: '...',
    target: '...',
  },
]
```

## Step 5

Добавить tests.

---

# 36. Translation quality rules

English translations должны:

- сохранять смысл оригинальной строки;
- использовать UI terminology самого DSH;
- избегать дословного машинного перевода;
- сохранять placeholders;
- сохранять punctuation semantics;
- сохранять hotkey labels;
- не переводить technical identifiers без необходимости.

Например:

```text
模型提供商
```

лучше:

```text
Model provider
```

а не странный буквальный вариант.

---

# 37. Security constraints

DOM translator считается потенциально чувствительной частью.

Запрещается:

- читать prompt content;
- отправлять DOM наружу;
- логировать conversation contents;
- сохранять пользовательский текст;
- изменять message history;
- изменять code/terminal output;
- выполнять HTML из translation values.

Translation values всегда устанавливать как:

```text
textContent / attribute string
```

Никогда:

```text
innerHTML
```

---

# 38. Testing

Использовать текущий test stack, совместимый с DSH plugin ecosystem.

Минимальный набор unit tests.

## Locale registry tests

### Test 1

Override найден:

```text
locale=en
namespace=foo
key=save
→ Save
```

### Test 2

Override отсутствует:

```text
→ original translate called
```

### Test 3

Locale `zh`:

```text
override ignored
```

### Test 4

Interpolation:

```text
Hello {name}
+
{name: "Alice"}
→ Hello Alice
```

### Test 5

Unknown placeholder сохраняется:

```text
Hello {name}
+
{}
→ Hello {name}
```

### Test 6

Bound translator был создан ДО установки patch.

Он всё равно должен использовать override.

### Test 7

Dispose восстанавливает original translate.

### Test 8

Double install не создаёт nested wrappers.

---

# 39. Registry tests

Проверить:

- несколько namespaces;
- несколько packs;
- missing key;
- duplicate key;
- deterministic conflict behavior;
- empty pack;
- malformed pack validation.

---

# 40. DOM tests

Использовать jsdom или эквивалент.

Проверить:

### Existing DOM

```html
<div class="foo">
  <button>设置</button>
</div>
```

становится:

```html
<button>Settings</button>
```

### Dynamic DOM

После запуска observer добавляется:

```html
<button>删除</button>
```

и переводится.

### Wrong scope

Одинаковая китайская строка вне `.foo` не изменяется.

### Code

```html
<code>设置</code>
```

не изменяется.

### Textarea

Не изменяется.

### contenteditable

Не изменяется.

### User message container

Не изменяется.

### Attribute

`placeholder` переводится только при наличии соответствующего rule.

---

# 41. Integration test

Если test harness позволяет поднять минимальный DSH client runtime:

Создать fake third-party plugin:

```text
fake-chinese-plugin
```

Он должен иметь:

1. LocaleRuntime-based text.
2. Hardcoded DOM text.

Проверить:

```text
locale=en
```

→ обе строки английские.

```text
locale=zh
```

→ locale text оригинальный.

---

# 42. README

README должен содержать:

```text
What it does
Why it exists
Installation
How translation packs work
How to add a translation pack
Locale override example
DOM fallback example
Safety rules
Known limitations
Compatibility
```

Обязательно явно написать:

> dsh-l10n-overrides is not affiliated with or a modification of the translated third-party plugins. Translation packs are maintained independently.

---

# 43. Compatibility philosophy

Никаких compile-time imports из внутренних файлов target plugins.

Запрещено:

```ts
import something from 'target-plugin/src/internal'
```

Translation pack должен зависеть только от:

```text
namespace names
translation keys
visible DOM selectors/text
```

Это позволяет target plugin обновляться независимо.

---

# 44. DSH compatibility

Использовать public DSH APIs везде, где возможно.

Единственное намеренное исключение:

```text
LocaleRuntime.translate monkey patch
```

потому что штатный registry не предоставляет overlay API.

Этот hack должен быть:

- минимальным;
- изолированным;
- reversible;
- feature-detected;
- покрытым tests.

Перед patch:

```ts
if (typeof locale.translate !== 'function') {
  diagnostics.error(...)
  return
}
```

Plugin не должен ломать загрузку всего Harness при несовместимости.

---

# 45. Graceful failure

Если новая версия DSH изменила LocaleRuntime:

```text
dsh-l10n-overrides must fail open
```

То есть:

- DSH продолжает работать;
- target plugins продолжают работать;
- translations могут отключиться;
- console получает понятный warning/error.

Никакого fatal throw из plugin startup.

---

# 46. Feature detection

Перед активацией locale hook проверить:

```text
ctx.locale exists
ctx.locale.getSnapshot is function
ctx.locale.translate is function
```

Если DOM API отсутствует, например SSR/test runtime:

```text
skip DomTranslator
```

Проверка:

```ts
if (typeof document === 'undefined') {
  return
}
```

---

# 47. MVP scope — v0.1.0

В `v0.1.0` обязательно реализовать:

- DSH client plugin;
- English locale overrides;
- TranslationPackRegistry;
- `LocaleRuntime.translate` wrapper;
- interpolation;
- multiple packs;
- collision detection;
- MutationObserver DOM fallback;
- scoped exact text rules;
- excluded editable/code surfaces;
- locale change handling;
- clean disposal;
- diagnostics;
- tests;
- README;
- минимум один example pack.

---

# 48. P1 / future

После рабочего MVP можно добавить:

## External packs

Загрузка translation packs отдельно от основного npm package.

Например:

```text
dsh-l10n-overrides
dsh-l10n-pack-plugin-a
dsh-l10n-pack-plugin-b
```

Но не усложнять `v0.1`.

## Additional locales

```text
ru
de
fr
...
```

Только если DSH runtime сам поддерживает соответствующий locale.

## Settings UI

Страница:

```text
Settings → Translation Overrides
```

с:

```text
Enabled packs
Locale override count
DOM rule count
Compatibility warnings
Debug mode
```

Не требуется для MVP.

## Developer inspector

Debug feature, позволяющая определить:

```text
namespace
key
current translation
matching pack
```

Также не требуется для MVP.

---

# 49. Explicitly forbidden implementation shortcuts

Не использовать:

```text
patch-package
sed against node_modules
postinstall modifications
fork target plugin
replace document.body.innerHTML
global string replace
React monkey patch
polling with setInterval
LLM translation at runtime
network translation API
```

Не реализовывать решение через изменение исходников DeepSeek Harness.

---

# 50. Acceptance criteria

Работа считается завершённой, если выполняются все условия:

- [ ] `dsh-l10n-overrides` устанавливается как обычный DSH plugin.
- [ ] Никакие target plugins не модифицируются.
- [ ] Translation pack может override существующий locale namespace/key.
- [ ] Не используется duplicate `locale.register()` для чужого namespace.
- [ ] Existing `locale.bind()` translators получают overrides.
- [ ] Missing overrides корректно уходят в original DSH translation.
- [ ] Overrides активны только для соответствующего locale.
- [ ] `{placeholder}` interpolation работает.
- [ ] Несколько translation packs могут работать одновременно.
- [ ] Duplicate overrides диагностируются.
- [ ] Hardcoded DOM text может переводиться scoped rule.
- [ ] Динамически появившийся DOM переводится.
- [ ] `input`, editor, code, terminal и conversation content не повреждаются.
- [ ] MutationObserver не делает full-page scan на каждое изменение.
- [ ] Plugin корректно освобождает observer/listeners.
- [ ] Original `locale.translate` восстанавливается при dispose.
- [ ] Несовместимая версия DSH не приводит к падению всего UI.
- [ ] Есть unit tests.
- [ ] Есть DOM tests.
- [ ] README описывает создание нового translation pack.
- [ ] Есть минимум один example translation pack.

---

# 51. Definition of Done

Итоговый repository должен быть пригоден для следующего workflow:

```text
1. Пользователь устанавливает dsh-l10n-overrides.
2. Пользователь устанавливает китайский сторонний plugin без изменений.
3. В dsh-l10n-overrides добавляется отдельный translation pack.
4. Пользователь выбирает English в DSH.
5. Строки через DSH locale API заменяются на английские.
6. Hardcoded строки при необходимости заменяются через scoped DOM rules.
7. Обновление стороннего plugin не требует fork/rebase.
8. Если upstream изменил keys/selectors, чинится только соответствующий translation pack.
```

Главный архитектурный принцип проекта:

> **Translate plugins from the outside; never own or modify their source.**