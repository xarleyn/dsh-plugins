# DSH Plugin Guidelines

Качественные guidelines для текущих и будущих плагинов DeepSeek Harness в этом
монорепо: архитектура, содержание пакета, качество кода, тестирование,
документация и процесс релиза.

**Статус:** канонический документ по умолчанию. Если `CONTRIBUTING.md`,
скрипты-проверки или генератор противоречат этому документу — приоритет у
этого документа, а расхождение надо чинить (см. [приложение B](#приложение-b-известные-расхождения)).

**Кому обязателен:** всем пакетам под `plugins/*`; разделам про shared-пакеты —
всем пакетам под `packages/*`.

---

## Оглавление

1. [Модель DSH-плагина](#1-модель-dsh-плагина)
2. [Классификация плагинов](#2-классификация-плагинов)
3. [Архитектурные правила](#3-архитектурные-правила)
4. [Содержание пакета](#4-содержание-пакета)
5. [Качество кода](#5-качество-кода)
6. [Тестирование и верификация](#6-тестирование-и-верификация)
7. [Совместимость](#7-совместимость)
8. [Документация](#8-документация)
9. [Процесс: коммиты, PR, релизы](#9-процесс-коммиты-pr-релизы)
10. [Чек-листы](#10-чек-листы)
11. [Анти-паттерны](#11-анти-паттерны)
12. [Приложение A: enforced-правила и их проверки](#приложение-a-enforced-правила-и-их-проверки)
13. [Приложение B: известные расхождения](#приложение-b-известные-расхождения)

---

## 1. Модель DSH-плагина

Плагин DSH — это npm-пакет, который хост (и/или клиент) DSH подгружает через
механизм Cordis-бандлов. Ключевые сущности:

| Сущность | Что это | Где описывается |
| --- | --- | --- |
| **Host-часть** | Код в процессе хоста: сервисы, хранилище, инструменты, слушатели жизненного цикла | `src/index.ts`, `src/host/**` |
| **Client-часть** | Код в браузере (Web GUI): UI-слоты, shortcuts, мосты к host-сервисам | `src/client.ts` или `src/client/index.ts` |
| **Bundle patch** | Декларация, которой плагин вставляется в composition хоста | `cordis.patch.yml` |
| **Manifest** | Точки монтирования: `dsh.bundle.patch` и `dsh.client.inject` | `package.json` → поле `dsh` |
| **Remote-контракт** | RPC host↔client через Typert (`TypertRemoteService` + `Remote`) | `src/index.ts`, `src/remote.ts` |

Два правила, из которых растёт всё остальное:

- **Строка плагина в composition несёт два идентификатора.** `id` —
  runtime-идентификатор `dsh-<name>` (полное имя с префиксом `dsh-`, без
  npm-скоупа); `name` — точное npm-имя пакета `"@yadsh/dsh-<name>"` (в кавычках:
  `@` — зарезервированный символ YAML). По `id` строку адресуют patch-слои;
  по `name` хост резолвит сам пакет (package.json → поле `dsh`, exports) и по
  нему же отдаёт клиентский бандл — `/plugins/<name>/client.js`, то есть с
  npm-скоупом в сегменте пути, а не с runtime-id. Подробности — §4.3.
- **Хост владеет фреймворком.** Все `@deepseek-ai/*`-пакеты — всегда
  `peerDependencies` (диапазоны из `catalog:dsh`), никогда не `dependencies`.
  Локальные копии для разработки — в `devDependencies` из `catalog:dsh-dev`.

---

## 2. Классификация плагинов

От типа плагина зависят его обязательства. Выберите тип осознанно до
scaffolding и запишите его в SPEC.md.

| Тип | Пример | Peer-набор | Обязательные части |
| --- | --- | --- | --- |
| **Host-service** — сервисы, инструменты, команды; без UI | `dsh-doc-impact` | Cordis + доменные пакеты хоста (`dsh-llm`, `dsh-tools`, …) | `src/index.ts`, Config-схема, unit-тесты |
| **Host + Client UI** — полный стек: host-сервис + RPC + UI в Web GUI | `dsh-draft-sessions`, `dsh-sleev`, `dsh-prompt-firewall` | Cordis + gateway + client runtime/UI + typert-protocol (+ `react`/`react-dom` для UI) | всё из host-service + `src/client/**`, `dsh.client.inject`, client-тесты, verify-client-bundle |
| **Client-only** — только Web GUI; host-вход формальный | `dsh-l10n-overrides` | Cordis + нужные клиентские пакеты | client-логика с graceful degradation; host-`apply()` может быть пустым |
| **Инфраструктурный** — работает через `dsh-fs`/`dsh-sandbox`/`dsh-session`, может не иметь Cordis-пиров | `dsh-session-scope` | доменные пакеты без Cordis (по необходимости) | объяснение в SPEC.md, почему нет Cordis |

Правило выбора пиров: **объявляйте только те `@deepseek-ai/*`-пакеты, чью
поверхность вы реально импортируете.** Каждый лишний пир — это чужое
обязательство совместимости (см. матрицу в `docs/COMPATIBILITY.md`).

---

## 3. Архитектурные правила

### 3.1 Границы монорепо и зависимости

Полный свод правил — SPEC §27, автоматически проверяется `pnpm deps:check`
(см. приложение A). Суть:

1. **Плагины зависят от shared-пакетов, но не друг от друга.** Никаких
   `@yadsh/dsh-<other-plugin>` в зависимостях плагина. Общая логика — в
   `packages/plugin-kit`, тестовая — в `packages/test-kit`, конфиги — в
   `packages/config`.
2. **Shared-пакеты не знают о плагинах.** `packages/*` не может импортировать
   ничего из `plugins/*`.
3. **`@deepseek-ai/*` — только `peerDependencies`** + копия в `devDependencies`
   (`catalog:dsh-dev`) для локальной разработки. `react`/`react-dom` у
   UI-плагинов — тоже пиры (`^18.2.0`).
4. **Обычные `dependencies` — только для внешних рантайм-библиотек**, у которых
   нет аналога в хосте (пример: `zod`). Прежде чем добавить зависимость,
   проверьте, нет ли её среди пиров хоста.
5. **`test-kit` — только в `devDependencies`.**
6. **Каждый импорт объявлен в манифесте; никаких надежд на hoisting**
   (`nodeLinker: isolated` делает это физически невозможным).
7. **Никаких deep-импортов** (`@yadsh/x/src/...`, `../../other-plugin/src/...`)
   и импортов мимо объявленного `exports`.
8. **Циклы запрещены** — DFS-проверка + `disallowWorkspaceCycles: true`.

Если двум плагинам нужен общий код — поднимайте его в `packages/plugin-kit`
(рантайм) или `packages/test-kit` (тесты). Убедитесь, что код действительно
общий, а не «пока похожий»: shared-пакет — это публичный контракт для всех.

### 3.2 Структура исходников

Рекомендованная раскладка (по ней живут `dsh-draft-sessions`,
`dsh-l10n-overrides`, `dsh-sleev`):

```
plugins/<name>/
├── src/
│   ├── index.ts          # host-вход: сервис, Config, Remote-контракт
│   ├── remote.ts         # Typert Remote-описание (если есть RPC)
│   ├── host/             # host-домен: store, errors, schema
│   ├── client/           # client-вход и UI-мосты (или src/client.ts)
│   ├── shared/           # типы и константы, общие для host и client
│   ├── adapters/         # адаптация поверхностей DSH (feature detection)
│   ├── registry/         # реестры/диагностика (если применимо)
│   └── runtime/          # механизмы клиента (DOM, подписки, хуки)
├── tests/                # *.test.ts, зеркалит src
├── scripts/              # verify-*.mjs, smoke-packed-*.mjs
├── docs/                 # images/, specs/
├── cordis.patch.yml
├── compatibility.json
├── package.json, tsconfig*.json, tsdown.config.ts, vitest.config.ts
├── README.md (+ README.ru.md / README.zh-CN.md), SPEC.md, ROADMAP.md
└── LICENSE, CHANGELOG.md
```

Принципы раскладки:

- **Host не импортирует `src/client/**` и наоборот** — общее только через
  `src/shared/**`. Клиентский код собирается отдельным бандлом и не должен
  тащить Node-зависимости.
- **`shared/` — без side effects**: только типы, константы, чистые функции.
- **Адаптеры (`adapters/`) — единственное место, которое знает конкретную
  поверхность DSH.** Остальной код работает с адаптером; так обновление DSH не
  превращается в правки по всему плагину.

### 3.3 Контракты Cordis: inject / apply / dispose

Host-вход — классический Cordis-плагин. Эталон: `src/index.ts` +
`src/client/index.ts` в `dsh-draft-sessions`.

```ts
// src/index.ts (host)
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

export interface Config {
  readonly storagePath?: string;   // каждый конфиг — документирован
  readonly maxItems?: number;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    myService: MyService;          // service augmentation — типизированно
  }
}

export class MyService {
  static Config: z<Config> = z.object({
    storagePath: z.string().default(""),
    maxItems: z.number().default(100),
  });
  constructor(ctx: Context, config: Config = {}) { /* ... */ }
}
```

Правила:

1. **Конфигурация — только через Schemastery-схему** (`static Config`), с
   явными defaults. Никакого сырого чтения env/файлов на старте.
2. **Каждое поле конфига имеет JSDoc-комментарий** — это пользовательский
   контракт плагина.
3. **Состояние и поведение — в сервисах/классах**, вход остаётся тонким:
   сборка зависимостей и регистрация.
4. **Пути данных по умолчанию — под `$DSH_HOME`**, абсолютный путь — опция
   конфига.
5. **Client-вход объявляет `inject` и возвращает dispose:**

```ts
// src/client/index.ts
export const inject = ["remote", "connection", "sessions", "conversation"];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const dispose = await ctx.remote.$mount(myRemote);
  // ...регистрация UI-слотов, слушателей, shortcuts
  return dispose; // обязан откатить всё, что сделал apply
}
```

6. **Module augmentation `Context` — для всего, что плагин кладёт в контекст.**
   Имя свойства — доменное (`draftSessions`), без префиксов вида `myPluginX`.
7. **Typert/декораторы:** если сборка не сохраняет стандартные декораторы,
   используйте явную регистрацию через протокол `Remote` (см.
   `registerRemoteMethod` в `dsh-draft-sessions`) и прокомментируйте, почему.

### 3.4 Ресурсы и очистка

Самая частая причина плохих плагинов — утечка ресурсов при dispose/reload.

- **Симметрия**: на каждый `addEventListener`/`MutationObserver`/`ctx.on`/
  `$mount`/таймер — обратное действие в dispose-цепочке.
- **Dispose идемпотентен**: повторный вызов безопасен, частично провалившаяся
  очистка не роняет хост и диагносцируется.
- **Разделяемые установки — по refcount/lease** (эталон: `SharedInstallation`
  в `dsh-l10n-overrides`): вторая установка того же ресурса увеличивает счётчик
  и возвращает lease вместо повторной регистрации.
- **Client-код не держит глобальных ссылок на DOM-узлы** после dispose.

### 3.5 Данные и устойчивость

Если плагин что-то хранит на диске (host-часть):

1. **Формат файла версионируется** (`formatVersion`), записи — с `revision`
   для оптимистичных обновлений.
2. **Повреждённые/неподдерживаемые данные — fail loudly.** Никогда не
   «молчно сбрасываем» пользовательские данные: ошибка с внятным сообщением
   вместо тихого `rm`.
3. **Запись — атомарная** (write-to-temp + rename), чтение — с обработкой
   частичной записи.
4. **Лимиты обязательны** (например, максимум записей на workspace) —
   конфигурируемые, с безопасным дефолтом.
5. **Удаление плагина не портит данные хоста**: плагин не мутирует чужие
   сущности, только свои (контракт «Plugin removal is safe» из
   `dsh-draft-sessions`).

### 3.6 Клиент: graceful degradation и диагностика

Браузер — враждебная среда: другая версия DSH, отсутствие DOM, гонки загрузки.

- **Каждая интеграция с поверхностью DSH — через try/catch с fallback.**
  Отсутствие возможности (`ctx.locale` недоступен, DOM нет) снижает
  функциональность, но не роняет клиент (эталон: `apply()` в
  `dsh-l10n-overrides`).
- **Diagnostics — со стабильными кодами** (`dom_unavailable`,
  `locale_listener_failed`, …): код — машиночитаемый идентификатор, сообщение —
  для человека. Коды не переиспользуются под другой смысл.
- **Опциональные протоколы фиксируйте в `compatibility.json`**
  (`requiredClientFeatures`, `optionalClientProtocols`).
- **Не блокируйте загрузку**: тяжёлая инициализация — после первого кадра или
  лениво по событию.

### 3.7 Host↔Client контракт

- RPC-контракт описывается Typert-схемами в `src/remote.ts`; запросы/ответы —
  типизированные структуры из `src/shared/types.ts`.
- Методы Remote — именованные, плоские, с идемпотентностью там, где возможен
  повтор (клиент может реконнектиться).
- Контракт — часть публичного API пакета: изменение формы запроса/ответа —
  это минорная (при обратной совместимости) или мажорная (иначе) версия.
- Клиент не полагается на порядок вызовов; host не полагается на то, что
  клиент онлайн.

---

## 4. Содержание пакета

### 4.1 Обязательные файлы

| Файл | Обязателен | Назначение |
| --- | --- | --- |
| `package.json` | ✔ | Манифест по §4.2 |
| `cordis.patch.yml` | ✔ | Вставка в composition хоста |
| `README.md` | ✔ | См. §8 |
| `SPEC.md` | ✔ | Продуктовый контракт; единственная спека в корне, спеки доработок — `docs/SPEC-<plugin>-<topic>.md`, см. §8.2. В tarball не публикуется (§4.2) |
| `LICENSE` | ✔ | Копия корневого MIT |
| `compatibility.json` | ✔ (publishable) | Машиночитаемая совместимость, см. §7 |
| `tsconfig.json` / `tsconfig.build.json` | ✔ | Расширяют `@yadsh/dsh-config` |
| `tsdown.config.ts` | ✔ (если есть client- или доп. бандлы) | Сборка клиентских/дополнительных бандлов |
| `vitest.config.ts` | ✔ (если нужны настройки сверх общего пресета) | Реэкспорт конфига из `@yadsh/dsh-config` |
| `tests/` | ✔ (кроме spec-only) | См. §6 |
| `README.ru.md`, `README.zh-CN.md` | recommended | Переводы README |
| `ROADMAP.md` | optional | Публичные планы |
| `docs/architecture.md` | recommended при сложности | Внутренняя архитектура |
| `CHANGELOG.md` | авто | Генерируется Nx release, не редактируется руками |
| `AGENTS.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` | optional | Копируются с существующих плагинов при необходимости |

Директория без `package.json` — легальная форма «spec-only», пока плагин
проектируется: в ней есть только спецификация, а корневой README обязан
помечать её «not publishable» до появления кода. `plugins/dsh-ui-repair`
использовал эту форму и с тех пор стал обычным публикуемым пакетом, поэтому
теперь owes полный контракт §4.1, как и любой другой плагин.

### 4.2 `package.json` — эталон

Минимальный корректный манифест плагина (сверяйте с актуальными плагинами):

```jsonc
{
  "name": "@yadsh/dsh-<name>",
  "version": "0.0.0",
  "description": "…",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xarleyn/dsh-plugins.git",
    "directory": "plugins/dsh-<name>"
  },
  "homepage": "https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-<name>#readme",
  "bugs": { "url": "https://github.com/xarleyn/dsh-plugins/issues" },
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".":       { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":{ "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./types": { "types": "./lib/types/shared/types.d.ts", "default": "./lib/shared/types.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["…dsh-client-пакеты…"], "platform": "web" }
  },
  "files": [
    "lib/**/*.js", "lib/types/**/*.d.ts",
    "cordis.patch.yml", "compatibility.json",
    "README.md", "LICENSE"
  ],
  "scripts": {
    "build": "pnpm run clean && tsdown && tsc -p tsconfig.build.json",
    "lint": "eslint src tests scripts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "verify:package": "node scripts/verify-package.mjs && node scripts/verify-client-bundle.mjs && node scripts/verify-compatibility.mjs",
    "verify": "pnpm run verify:package",
    "check": "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run verify",
    "prepack": "pnpm run build && pnpm run verify"
  },
  "keywords": [
    "deepseek",
    "deepseek-harness",
    "dsh",
    "dsh-plugin",
    "cordis",
    "<feature-specific words>"
  ],
  "license": "MIT",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "peerDependencies": { "@deepseek-ai/cordis": "catalog:dsh" },
  "devDependencies": { "@deepseek-ai/cordis": "catalog:dsh-dev" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

Правила:

- **Публикационные metadata каноничны для monorepo.** `repository.url`,
  `repository.directory`, `homepage`, `bugs.url` и `publishConfig` должны
  совпадать с примером выше. Это требуется для npm Trusted Publishing и
  provenance и проверяется tarball-gate. Новый пакет начинает с `0.0.0`, а
  первая пользовательская версия получается из обязательного Nx Version Plan.
- **`keywords` — это контракт обнаружения, а не вкусовщина.** Канонический
  набор: `deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis` — DSH-
  индексаторы, маркетплейсы и npm-поиск ищут именно по ним; дальше — слова про
  возможности. Только lowercase, без повторов. Гейт `pnpm verify:packages`
  жёстко требует `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis` и непустой
  `description` с упоминанием DeepSeek Harness или DSH, вместе с
  `repository.directory` и `homepage`: индексатор, который не может связать
  npm-пакет с его директорией в монорепе, показывает пакет как «без публичного
  репозитория». Генератор нового плагина сразу ставит весь канонический набор.
- **Каталоги в корне: `plugins.json` и таблица пакетов в `README.md`.** Оба
  генерируются из манифестов (`pnpm plugins:manifest`): `plugins.json`
  связывает npm-имя, директорию, описание, keywords, команду установки и
  homepage, а таблица в README описывает весь лэйаут — публичные пакеты
  с npm-именем, приватная сборка как `private workspace package`.
  `pnpm verify:packages` падает, пока устарел любой из них, а `plugins.json`
  дополнительно валидируется по `docs/plugins.schema.json`. После изменения
  описания/keywords или появления нового пакета их нужно перегенерировать —
  руками не редактировать. Расширяя схему новым ключевым словом, добавь его в
  `scripts/json-schema-validate.mjs`: незнакомое ключевое слово там не
  игнорируется, а роняет проверку.
- **`exports` — исчерпывающая карта публичных входов.** Всё, что не в `exports`,
  — внутреннее (проверяется гейтом §27.10). Каждый вход: `types` + `default`.
  Всегда включайте `./package.json`.
- **`files` — белый список того, что нужно установленному пакету.** Публикуются
  только: собранный рантайм (`lib/**`), `cordis.patch.yml`, `compatibility.json`
  (и другие рантайм-данные вроде `capability-policy.json`), юридические
  уведомления (`LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`), `README.md`
  как его рендерит npm и картинки, на которые он ссылается (`docs/images/*`).
  **Документация не публикуется**: `SPEC.md`, `CHANGELOG.md`, `ROADMAP.md`,
  `docs/**` (кроме `docs/images/`), `INVESTIGATE.md`, переводы README —
  всё это остаётся в репозитории. Так установка не тянет лишние килобайты,
  а реестр не превращается в файлопомойку. Правило проверяет
  `pnpm verify:packages`.
- **Ссылки в README — либо внутрь пакета, либо абсолютные.** README попадает в
  tarball, поэтому относительная ссылка на непубликуемый документ на странице
  npm рендерится мёртвой. Ссылайтесь как
  `https://github.com/xarleyn/dsh-plugins/blob/main/<path-from-repo-root>`;
  гейт `pnpm verify:packages` отвергает относительную ссылку, которую тарбол не
  покрывает.
- **`dsh.client.inject`** перечисляет ровно те DSH-клиентские пакеты, чьи
  поверхности импортирует client-часть.
- **Скрипты:** `check` — полный локальный конвейер; `verify` — package-гейты;
  имена не переизобретать (CI и скрипты рассчитаны на них).
- **Lifecycle:** установка workspace только устанавливает зависимости. Сборка
  выполняется Nx по графу, а `prepack` собирает публикуемый артефакт. `prepare`
  не используется: установка отдельных пакетов напрямую из Git для этого
  monorepo не поддерживается (Git URL указывает на private root package, а не
  на publishable подпакет). Для установки используйте npm-версию или готовый
  tarball.

### 4.3 `cordis.patch.yml`

Актуальный формат — список вставок (эталон — плагины этого репозитория):

```yaml
# The DSH plugin manager discovers this bundle through package.json.
- insert:
    - id: dsh-<name>              # runtime-id: identity строки в composition
      name: "@yadsh/dsh-<name>"   # точное npm-имя пакета; кавычки обязательны
```

Что влияет каждый идентификатор:

- **`id` = `dsh-<name>`** — полный unscoped runtime-id (обязательно с префиксом
  `dsh-`, без npm-скоупа). Это identity-ключ строки в composition хоста:
  последующие patch-слои (включая пользовательский patch-слой профиля)
  адресуют строку по `id`, чтобы переопределить `config` или отключить плагин.
  `id` не участвует в URL клиентского бандла — тот собирается из полного
  npm-имени (`/plugins/@yadsh/dsh-<name>/client.js`, см. §1) — но `id`
  адресует строку из patch-слоёв, поэтому держите его без `/`, `@` и пробелов.
- **`name` = точное npm-имя `"@yadsh/dsh-<name>"`** — по нему хост резолвит
  пакет (package.json → `dsh.bundle.patch`, `dsh.client`, exports) и сверяет
  строку при override-патчах: патч с `name`, не совпавшим со строкой,
  пропускается с warning. Значение пишется **в двойных кавычках**: `@` —
  зарезервированный символ YAML, и `yaml.load` (парсер профиля DSH) отвергает
  plain-скаляр, начинающийся с `@`. Должно символьно совпадать с опубликованным
  именем пакета.
- Пара `id`/`name` стабильна: их смена — breaking-миграция (override-слои,
  таргетившие старый `id`, получают warning «entry not found» и пропускаются).
- Файл начинается комментирующей строкой о механизме обнаружения.
- Формат патча — часть bundle-контракта DSH; изменения согласовывайте с
  версией DSH.

### 4.4 Сборка

- ESM-only (`"type": "module"`), целевой синтаксис — Node 22.
- Допустимы два layout деклараций: plain `tsc` выдаёт `lib/index.js` и
  `lib/index.d.ts`; bundled multi-entry/client package выдаёт `lib/*.js` и
  `lib/types/**/*.d.ts`. Поля `types` и `exports` обязаны указывать на реально
  существующий layout, оба варианта проверяются packed smoke.
- Plain Node packages наследуют `@yadsh/dsh-config/tsconfig/node`; packages с
  browser/client entrypoint наследуют `@yadsh/dsh-config/tsconfig/browser` или
  сохраняют более строгий явный mixed config. Генератор выбирает preset по
  флагу `client`.
- Относительные импорты внутри пакета — **всегда с расширением `.js`**
  (`verbatimModuleSyntax` + ESM).
- `lib/` не коммитится, кроме случаев, явно оговорённых в `.gitignore`
  плагина; чистая пересборка — часть `build`.

---

## 5. Качество кода

### 5.1 TypeScript

- База — `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: bundler`.
  Локальный `tsconfig` только сужает, не ослабляет.
- **`any` запрещён в публичных контрактах** (экспортируемые типы, Remote-схемы,
  Config). Внутри плагина `any` технически допустим линтером, но каждое
  вхождение — кандидатом в `unknown` + сужение.
- Типы, импортируемые только как типы, — через `import type`.
- Публичные типы экспортируются из входных точек; `src/shared/types.ts` —
  единый источник доменных типов для host и client.

### 5.2 Ошибки и логирование

- **Хост не должен падать из-за плагина**: ошибки в границах интеграции
  перехватываются, диагностируются и деградируют функциональность; fail loudly —
  только для повреждённых собственных данных (§3.5.2).
- Ошибки домена — типизированные классы (`DraftStoreError`), а не строки.
- Логирование — пакет `@yadsh/dsh-plugin-log` поверх `pino` (механизм,
  формат и рецепт подключения — [PLUGIN_LOGGING.md](./PLUGIN_LOGGING.md)):
  NDJSON-файлы в `<$DSH_HOME>/logs/<id>/`, уровни, ежедневная ротация,
  консольное зеркало `warn+` и автоматический runtime-реестр потребителей.
  В логах нет секретов, токенов и содержимого пользовательских промптов без
  явной необходимости.

### 5.3 Зависимости от среды

- Клиентский код не импортирует `node:*`. Host-код — без браузерных глобалов.
- Доступ к `document`/`window` — с проверками (`typeof document === "undefined"`),
  инъекция `Document` в опциях для тестируемости (паттерн `ClientOptions`).

---

## 6. Тестирование и верификация

### 6.1 Пирамида

| Уровень | Что проверяет | Инструмент | Где |
| --- | --- | --- | --- |
| **Unit** | Чистая логика: конфиг, CRUD, парсинг, интерполяция, ошибки | Vitest | `tests/*.test.ts` |
| **Client/DOM** | UI-мосты, DOM-правила, подписки, cleanup | Vitest + jsdom + `@testing-library/*` | `tests/` |
| **Package gates** | Манифест, exports, files, клиентский бандл, compatibility.json | `scripts/verify-*.mjs` | `pnpm verify` |
| **Packed smoke** | Тарбол ставится в чистый consumer, вход грузится в Node | `scripts/tarball-verify.sh` | repo-гейт |
| **Browser e2e** | Реальный DSH + плагин в браузере | Playwright (`smoke-packed-dsh.mjs --browser`) | по возможности |

Раскладка тестов по умолчанию — плоская: `tests/*.test.ts`, зеркалящие
`src/`, плюс общие фикстуры и фейки в `tests/helpers/`. Подкаталоги
`tests/unit/` и `tests/integration/` вводятся только тогда, когда в пакете
реально появились интеграционные тесты, требующие отдельного слоя (как в
`dsh-cas-results`); структура «про запас» не нужна — общий vitest-пресет
находит `.test.ts` на любой глубине.

### 6.2 Что обязательно покрыть

- Парсинг/валидацию конфига (включая пустой и невалидный).
- Основной CRUD/сценарий плагина — на уровне контракта SPEC.md.
- **Dispose-путь**: после dispose не остаётся подписок/узлов; повторный
  apply работает.
- **Пути деградации** клиента: отсутствие DOM, отсутствие сервиса, отказ
  подписки.
- Повреждение данных (для хранилищ): ошибка без молчаливого сброса.

Каждый `src/<модуль>.ts` имеет зеркальный `tests/<модуль>.test.ts`. Отступление
(например, тонкий вход без логики) — одна строка-объяснение в PR.

### 6.3 Definition of Done (локально)

```bash
pnpm --filter <plugin> check                        # все package-local гейты
pnpm deps:check                                     # границы §27
pnpm tarball:verify:packages plugins/<name>         # тарбол + чистая установка
```

CI (`ci.yml`) гоняет `deps:check`, affected `lint/typecheck/test/build/verify`,
`pnpm release:check` и tarball-verify затронутых пакетов. Всё это должно
проходить локально до PR.

---

## 7. Совместимость

Базовая линия и политика — `docs/COMPATIBILITY.md`. Правила плагина:

1. **Пиры — только из `catalog:dsh`**, dev-копии — из `catalog:dsh-dev`.
   Вручную диапазоны не писать.
2. **`compatibility.json` в корне плагина** отражает реальность:

```json
{
  "deepseekHarness": {
    "channel": "next",
    "range": ">=0.1.5-rc.2 <0.2.0",
    "testedReleases": ["0.1.5-rc.2"],
    "requiredClientFeatures": ["sidebar.footer.action"],
    "optionalClientProtocols": ["__dshNativeTabs@1"]
  },
  "node": "^22.19.0 || >=24.0.0"
}
```

3. **Feature detection вместо версионных проверок** там, где это возможно:
   проверяйте наличие возможности, а не версию пакета — для грубых гейтов
   старта объявляйте требование в `compatibility.json`, а не сравнивайте
   мажоры в рантайме.
4. Опора на `optionalClientProtocols` должна быть безопасной при их отсутствии.
5. Сужение/расширение поддерживаемого диапазона DSH — **breaking change**
   пакета и требует обновления `docs/COMPATIBILITY.md` + README плагина.
6. Новая версия DSH: обновить оба каталога одним коммитом, прогнать полный
   `pnpm check` + `tarball:verify`, обновить матрицу совместимости.

---

## 8. Документация

### 8.1 README.md — структура

Эталон: `plugins/dsh-draft-sessions/README.md`. Обязательные секции, в порядке:

1. Название + одно предложение «что это для пользователя DSH».
2. Скриншот/демо (если есть UI) — `docs/images/`, попадает в tarball; остальные
   ссылки на документы репозитория (`SPEC.md`, `docs/**`, `ROADMAP.md`,
   `CHANGELOG.md`, переводы README) — абсолютными URL на GitHub (§4.2).
3. **Features** — маркированный список реальных возможностей.
4. **Install** — `dsh plugin --profile <profile> add @yadsh/dsh-<name>` для
   host-плагина и `dsh plugin --profile web add @yadsh/dsh-<name>` для плагина с
   клиентской частью (`dsh.client`), плюс вариант из исходников
   (`pnpm nx run @yadsh/dsh-<name>:build` + `dsh plugin --profile … add
   ./plugins/dsh-<name>`). `--profile` обязателен: `dsh plugin add <pkg>` CLI
   отвергает.
5. **Configuration** — таблица «опция / тип / default / описание» (зеркало
   Config-схемы).
6. **Compatibility** — диапазон DSH, Node; ссылка на `compatibility.json`.
7. **Development** — команды `pnpm build/test/check` этого плагина.
8. **License**.

Переводы `README.ru.md` / `README.zh-CN.md` — синхронны по структуре с
английским; при расхождении первичен `README.md`.

### 8.2 SPEC.md — продуктовый контракт

Каждый плагин имеет SPEC.md по образцу `dsh-draft-sessions`:

1. **Product contract** — нумерованные проверяемые гарантии («A user can keep
   at least 20 drafts…», «Creating a draft never sends a model request»).
   Формулировка — поведение, а не реализация.
2. **Data model** — формат хранения, версионирование, политика повреждений.
3. **Lifecycle** — диаграмма/текст состояний.
4. **Scope: Included / Deferred** — что не делаем и почему.
5. **Required end-to-end scenarios** — текстовые сценарии «шаг → ожидание»,
   которые ложатся в e2e-тесты.
6. **Implementation status** — таблица «область → Implemented/Partial/Planned».

SPEC.md обновляется вместе с изменением поведения; статус-таблица не должна
врать. Это первый файл, который читает новый контрибьютор и рецензент.

**В корне плагина ровно одна спека — `SPEC.md`.** Исходная спека реализации и
есть этот файл (после первых итераций он становится продуктовым контрактом).
Спеки доработок и дизайн-доки живут в `docs/specs/` под именем
`docs/specs/<topic>.md` (kebab-case, без имени плагина в имени файла) —
например `docs/specs/accounts.md` (аккаунты, dsh-qa-surface),
`docs/specs/design.md` (исходный дизайн, dsh-tool-offload). Не заводить в корне
`SPEC-<plugin>.md`, `dsh-<plugin>-SPEC.md` и файлы с неанглийскими именами;
в `docs/` не заводить спеки в старых стилях (`SPEC-<plugin>-<topic>.md`,
`<ТЕМА>-SPEC.md`, `<topic>-spec.md`):
`SPEC.md` в корне — единственная точка входа, остальное ссылки из него.

### 8.3 Прочее

- `docs/architecture.md` — при сложности: слои, потоки данных, решения.
- `docs/INVESTIGATE.md` — рабочие заметки по интеграции с хостом: какие DSH API
  и версии предполагаются, что проверено на живом стенде. Ссылки на конкретные
  § этого файла из `src/` допустимы и ожидаемы.
- `docs/specs/` — спеки доработок и дизайн-доки (`<topic>.md`); не заменяют
  SPEC.md.
- `docs/images/` — скриншоты для README (попадают в tarball).
- `ROADMAP.md` — только публичные намерения, без внутренних деталей.
- Язык: EN — первичный; RU/ZH — переводы. Код, идентификаторы, коды ошибок —
  всегда английские.

---

## 9. Процесс: коммиты, PR, релизы

### 9.1 Коммиты

Conventional Commits, скоуп — имя плагина:

```
feat(dsh-draft-sessions): add auto-save with configurable interval
fix(plugin-kit): fix version comparison for pre-release strings
docs: add plugin guidelines
```

- Один шаг = один коммит; коммит самодостаточен и проходит свои проверки.
- Не смешивать lifecycle/UI/зависимости/доки в одном коммите.
- Не коммитить заведомо сломанные промежуточные состояния.

### 9.2 PR

- Один плагин (или один shared-пакет) на PR.
- `pnpm affected:check` зелёный; для publishable-изменений — Version Plan в
  том же PR (`pnpm release:plan`).
- Описание: что и зачем; для новых плагинов — ссылка на SPEC.md.

### 9.3 Версии и релиз

- Independent versioning через Nx Version Plans (см. `docs/RELEASING.md`):
  план обязателен для любого publishable-изменения в `main`.
- Semver по духу: новое поле конфига/фича — minor; багфикс — patch; сужение
  совместимости, изменение Remote-контракта несовместимым образом, удаление
  exports — major.
- `CHANGELOG.md` генерируется — руками не править; содержательные изменения
  описывайте в тексте Version Plan.

---

## 10. Чек-листы

### 10.1 Новый плагин

- [ ] Выбран тип (§2) и написан SPEC.md (§8.2) — до кода.
- [ ] Директория `plugins/dsh-<name>`, npm-имя `@yadsh/dsh-<name>`, runtime
      id/`name` по §4.3.
- [ ] Manifest: `dsh.bundle.patch`, (для UI) `dsh.client.inject`, `exports`,
      `files`, peer/dev-зависимости из каталогов (§4.2).
- [ ] `cordis.patch.yml`, `LICENSE`, `compatibility.json` на месте.
- [ ] Config-схема Schemastery с defaults и JSDoc на каждое поле.
- [ ] apply/dispose симметричны; клиент деградирует, а не падает (§3.4, §3.6).
- [ ] Тесты: конфиг, основной сценарий, dispose, деградация (§6.2).
- [ ] README (+переводы), ROADMAP (опц.), scripts/verify-*.mjs (§8.1).
- [ ] Локально: `affected:check`, `verify`, `deps:check`, `tarball:verify`.
- [ ] Version Plan включён в PR.
- [ ] `pnpm plugins:manifest` выполнен (таблица пакетов в корневом `README.md`
      и `plugins.json` перегенерены), `docs/COMPATIBILITY.md` (матрица пиров)
      обновлён.

### 10.2 Перед каждым PR

- [ ] `pnpm affected:check` — зелёный.
- [ ] `pnpm deps:check` — зелёный.
- [ ] `pnpm tarball:verify` затронутых пакетов — зелёный.
- [ ] SPEC.md/README отражают поведение после изменений.
- [ ] Коммиты по конвенции; Version Plan для publishable-изменений.

---

## 11. Анти-паттерны

| ❌ Анти-паттерн | Почему плохо | Вместо |
| --- | --- | --- |
| Зависимость плагина от плагина | Связывает релизные циклы | Общий код в `packages/*` |
| `@deepseek-ai/*` в `dependencies` | Дублирует фреймворк в рантайме | `peerDependencies` + каталоги |
| Deep-импорт `@yadsh/x/src/…` | Обходит публичный контракт | `exports`-вход пакета |
| Молчаливый сброс повреждённых данных | Теряет пользовательские данные | Fail loudly + восстановление |
| `apply()` без dispose | Утечки при reload/remove | Симметричная очистка, lease |
| Глобальные сайд-эффекты при импорте | Ломает tree-shaking и тесты | Инициализация в `apply()` |
| Проверка версий DSH вместо feature detection | Хрупко при каждом релизе | Проверка возможности + `compatibility.json` |
| `any` в публичных типах | Убивает контракт потребителя | `unknown` + сужение |
| Уникальные имена скриптов в package.json | Ломает CI и гейты | Стандартный набор (§4.2) |
| README «how I built it» вместо контракта | Не отвечает на вопросы пользователя | Структура §8.1 + SPEC.md |
| Тяжёлая работа при импорте client-бандла | Тормозит загрузку Web GUI | Ленивая инициализация в apply |

---

## Приложение A: enforced-правила и их проверки

| Правило | Формулировка | Проверка |
| --- | --- | --- |
| §27.1 | Плагины могут зависеть от shared-пакетов | `pnpm deps:check` |
| §27.2 | Shared не зависят от плагинов | `pnpm deps:check` |
| §27.3 | `@deepseek-ai/*` — только peers | `pnpm deps:check` |
| §27.4 | `test-kit` — только devDependencies | `pnpm deps:check` |
| §27.5 | Нет циклов workspace | DFS + `disallowWorkspaceCycles` + `pnpm dedupe --check` |
| §27.6 | Каждый импорт объявлен в манифесте | `pnpm deps:check` (сканирование `src/tests`) |
| §27.7 | Hoisting не удовлетворяет необъявленное | `nodeLinker: isolated` + §27.6 |
| §27.8 | Нет deep-импортов `/src/` чужих пакетов | `pnpm deps:check` |
| §27.9 | Нет кросс-пакетных относительных/абсолютных импортов | `pnpm deps:check` |
| §27.10 | Workspace-пакеты потребляются через `exports` | `pnpm deps:check` |
| Tarball 1–7 | lib есть; манифест корректен; патч объявлен и упакован; exports существуют; нет `workspace:`/`catalog:` утечек; чистая установка + smoke-импорт | `scripts/tarball-verify.sh` |
| Release gates | Version plan обязателен; публикация через npm Trusted Publishing | `pnpm release:check`, `release.yml` |

## Приложение B: известные расхождения

Фиксируем, чтобы не принять за норму. Чинить по мере касания:

1. **Исправлено (2026-09-05):** корневой `dsh-plugins-monorepo-SPEC.md`
   перенесён из `.agents/notes/draft/` в корень репозитория; ссылки из
   `CONTRIBUTING.md` и скриптов («SPEC §27», «SPEC §16») теперь разрешаются.
2. **Генератор `pnpm nx g dsh-plugin`**: шаблон `cordis.patch.yml` приведён к
   каноническому формату (§4.3); README-шаблон базлайна DSH исправлен.
   Оставшийся пробел: starter-плагин не покрыт verify-скриптами
   (`verify-package` / `verify:client`).
3. **Мигрировано**: runtime-id без префикса (`draft-sessions`, `sleev`, …) и
   unscoped `name` заменены на канонические `id: dsh-*` / `name: @yadsh/dsh-*`
   во всех плагинах; `dsh-session-scope` — эталон по `id`. Пользовательские
   override-слои, таргетившие старые короткие `id`, будут пропускаться с
   warning «entry not found» — обновите их на новые `id`.
4. **ESLint-исключения** для `plugins/**` (off `no-explicit-any`,
   `consistent-type-imports`) — временное послабление: в новых плагинах
   держите уровень корневых правил, где это не блокирует интеграцию.

## Приложение C: статус разбиения крупных файлов (обновлено 2026-09-21)

- `dsh-l10n-overrides/tests/` — **выполнено**: мегатесты разбиты на тематические
  файлы (`dom-translator-*`, `locale-hook-*`, `registry-*`,
  `integration-client`), самый крупный тест пакета — 374 строки вместо 1273.
- `dsh-session-scope` — **сборка клиента мигрирована (2026-09-22):**
  `src/client.ts` больше не бандл, а обычный модуль, который собирает общий
  tsdown-пайплайн (`tsdown.config.ts` печатает регистрацию
  `window.__ModuleLoader__.load` и фабрику вокруг модуля). Файл исключён из
  `tsc`-сборки, поэтому `./client` в манифесте указывает прямо на бандл;
  `@ts-nocheck` снят, файл типизирован, lint-игнор убран, ручной правки
  `lib/client.js` больше нет. Осталось модульное разбиение одного файла
  (css/icons/paths/remote/editor — отдельные модули) и общий с `core.ts` хелпер
  путей — по-прежнему отдельный проект.
- `dsh-session-scope/src/index.ts` (907 строк) — разбиение на scope-patches/
  scope-commands/projections отложено вместе с клиентом.
