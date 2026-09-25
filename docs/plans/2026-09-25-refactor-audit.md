# Рефакторинг-аудит монорепозитория — срез 25.09.2026

Артефакт задачи 1 («repo-infra: рефакторинг-аудит: большие файлы, тесты,
структура каталогов»). Предыдущий срез 24.09 лёг в ветку `bot/1` и не был
слит; параллельно прошёл второй аудит (отчёт во вне-гитовом `.private/audits/`,
выводы — комментарием к карточке 1). Этот документ — перезамер того же набора
на текущем `main` плюс разбор находок, которые принёс комментарий: часть
формулировок 24.09 не подтвердилась, часть находок за это время получила
владельцев.

| | |
| --- | --- |
| Срез | `main` = `288e0d6`, рабочее дерево чистое |
| Ветка аудита | `bot/328` |
| Метод | статические замеры по `git ls-files` + полный прогон проверок с обходом кэша Nx + точечные эксперименты над кэшем и окружением |
| Объём | 26 плагинов, 7 пакетов, 1 генератор; 2326 отслеживаемых файлов, 505 514 текстовых строк; 973 файла `src` (`.ts`/`.tsx`) на 224 247 строк; 702 тест-файла `*.test.tsx?` в `*/tests/` |
| Код в этом прогоне | не менялся: документ — единственный результат |

Документ дополняет, но не отменяет
[`docs/plans/2026-09-02-refactor-plan.md`](./2026-09-02-refactor-plan.md)
(исторический план первой волны) и Приложение C в
[`../PLUGIN_GUIDELINES.md`](../PLUGIN_GUIDELINES.md) (статус разнесения файлов).

## Как снимали

```bash
git ls-files 'plugins/*/src/*.ts' 'plugins/*/src/*.tsx' \
             'packages/*/src/*.ts' 'packages/*/src/*.tsx' > src.txt
wc -l < src.txt                                 # 973 файла
xargs -a src.txt wc -l | tail -1                # 224 247 строк
git ls-files | grep -cE '/tests/.*\.test\.tsx?$'                   # 702
git ls-files -z | xargs -0 cat | wc -l                             # 505 514
git ls-files -z 'plugins/*/src/*' 'packages/*/src/*' | xargs -0 md5sum | sort | uniq -d -w32

npx nx run-many -t lint typecheck test build verify --skip-nx-cache --output-style=static
pnpm test:release ; pnpm format ; pnpm deps:check ; pnpm lint:workspace ; pnpm release:check
pnpm verify:packages ; pnpm verify:logging ; pnpm verify:a11y
env -u GIT_AUTHOR_NAME -u GIT_COMMITTER_NAME \
    -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_EMAIL \
    npx nx run @yadsh/dsh-git-readonly:test --skip-nx-cache
```

Пороги из разделов A4–A5 считались отдельно для `src` (800/1200), `*/tests/`
(400/800) и `scripts/*.mjs` (800/1200) по спискам `git ls-files`; в таблице
ниже везде `wc -l`.

Одноразовые измерители (ссылки в `.md`, экспорт-использование бэррелей,
прокси-покрытие) в трек не кладутся. Замечание к будущему гейту из A9: сканер
ссылок обязан пропускать блоки кода в `.md`, иначе он считает ссылками всё,
что написано в примерах.

## 1. Обязательное

### A1. `build` кэшируется без `outputs`, а кэш Nx — общий на все worktree

**Что.** В `nx.json` у `targetDefaults.build` стоит `cache: true` при отсутствии
поля `outputs` (`nx.json:38–42`: `inputs` есть, значит хэш задачи считается, а
сохранять нечего). Второе слагаемое: каталог кэша разрешается не в worktree, а в
основной клон — `.nx/cache` существует там и отсутствует в worktree, где шёл
этот прогон; более того, во время прогона `run.json` основного клона был
перезаписан чужим `run-many` из соседнего worktree. Итог: полосы делят один
кэш результатов, не деля артефакты сборки.

**Доказательство ( две проверки, обе воспроизводимы без `nx reset`).**

1. *Ложный зелёный.* Удалены `lib/` у четырёх публикуемых пакетов, затем
   `npx nx run-many -t build --projects=<те же четыре>`:
   `Successfully ran target build for 4 projects and 1 task they depend on`,
   `Nx read the output from the cache instead of running the command for
   5 out of 5 tasks`, exit 0. `lib/` на диске не появился. Средство, которым
   разработчик починил бы дерево (`pnpm build`), рапортует об успехе и не
   меняет ничего.
2. *Ложный красный.* В чистом дереве среза удаляем `packages/plugin-log/lib` и
   снимаем кэш только у потребителя
   (`npx nx run @yadsh/dsh-plugin-log-ui:typecheck`): три задачи `build`
   зависимостей помечены `[existing outputs match the cache, left as is]`, а
   запущенный `typecheck` падает с `TS2307: Cannot find module
   '@yadsh/dsh-plugin-log'` в `src/index.ts`, `src/log-buffer.ts`,
   `tests/integration.test.ts`, `tests/log-buffer.test.ts` плюс каскад `TS7006`
   (тип выводится из несуществующей декларации).

Побочный эффект того же порядка: полную полосу `run-many` Nx сопроводил отчётом
«14 flaky tasks» — в списке есть `typecheck` и `build` проектов, которые не
запускались повторно; а одиночный прогон `git-readonly:test` со снятым
окружением Nx назвал flaky при зелёном результате. «Нестабильность» здесь —
следствие того, что одно и то же дерево задач в разных worktree получает разные
исходы от общего кэша.

**Почему обязательно.** Порог входа («склонировал, `pnpm install`, `pnpm check`»)
и любая полоса в worktree зависят от `lib/` пакетов, на которые ссылаются 26
плагинов. Сейчас этот шаг либо молча зелёный без артефактов, либо красный с
ошибками компиляции в коде, которого не касались.

**Что делать.** `outputs: ["{projectRoot}/lib"]` в `targetDefaults.build`.
Отдельно проверить, куда Nx кладёт кэш в worktree-сценарии: если общий каталог
основного клона — намерение Nx, достаточно `outputs`; если нет — конфигурировать
`cache.directory` явно, иначе полосы будут отравлять кэш друг друга и после
починки `outputs`.

**Поправка к формулировке 24.09.** Там пункт был записан как «холодный checkout
красный (`pnpm check` → exit 130, 21 проект с TS2307)». Замер не подтверждает
это как постоянное свойство дерева: исход зависит от того, совпал ли хэш
конкретной задачи с общим кэшем. Надёжная формулировка: «кэш `build` не содержит
артефактов, и `pnpm build` в дереве без `lib/` завершается успехом, не создав
`lib/`». Красный вариант — лишь одно из двух проявлений.

**Владелец.** Новой карточки нет — пункт по-прежнему никем не взят. Оценка S;
проверять её обязан прогон на дереве без `lib/` (раздел 9), а не `pnpm check` на
прогретом.

### A2. `pnpm test:release` падает не на «Windows», а на standalone-сборке pnpm

**Что.** `scripts/release-workflow.test.mjs:49` берёт путь к CLI как
`const pnpmCli = process.env.npm_execpath;` и затем запускает его через
`process.execPath` (строка 485). Предпосылка «CLI — это JS-файл» выполняется
только для npm-global / corepack-установки pnpm (`pnpm.cjs`). Для
self-managed-установки (`%LOCALAPPDATA%/pnpm/.tools/pnpm-exe/<версия>/pnpm.exe`)
и для standalone-бинаря `npm_execpath` указывает на `.exe`, и Node пытается
прочитать PE-заголовник как JS.

**Замер 25.09.** На этой машине `pnpm test:release` даёт `tests 193 /
pass 193 / fail 0`, exit 0: PATH отдаёт `pnpm` из npm-global, `npm_execpath` —
`.cjs`. Вывод 24.09 («на Windows красным становится корневой гейт») здесь не
воспроизводится как данное.

**Воспроизведение всё-таки есть, и оно дешёвое.** Тот же прогон с
`npm_execpath`, указывающим на standalone-бинарь этой же машины:

```bash
npm_execpath="$LOCALAPPDATA/pnpm/.tools/pnpm-exe/<версия>/pnpm.exe" \
  node --test --test-name-pattern="publishes prepared tarballs" \
  scripts/release-workflow.test.mjs
# AssertionError [ERR_ASSERTION]: pnpm pack failed.
#   MZ…This program cannot be run in DOS mode.        → exit 1
```

**Почему обязательно.** Исход зависит от способа установки pnpm, а не от кода: на
машинах с `pnpm` из официального установщика гейт красный, и ни CI (только
`ubuntu-latest`, см. A8), ни «у меня работает» этого не поймают.

**Что делать.** Не полагаться на расширение `npm_execpath`: запускать `pnpm` как
исполняемый файл из `PATH`, либо разрешать обёртку `.cjs`/`.mjs` и иначе падать с
внятным сообщением. Рядом проверить `npmCli` (строки 42–48) — там та же
предпосылка про `node_modules/npm/bin/npm-cli.js`.

**Владелец.** Новая карточка, оценка S. В постановке писать «тест полагается на
то, что `npm_execpath` указывает на JS-файл», а не «Windows-фол».

### A3. Тесты `dsh-git-readonly` негерметичны к git-identify из окружения

**Что.** `plugins/dsh-git-readonly/tests/fixtures/git.ts:71–72` задаёт автора
локальным `git config user.name/user.email`, а `runGit` (строка 52) вызывает
`execFile` с наследуемым `process.env`. Переменные `GIT_AUTHOR_*` /
`GIT_COMMITTER_*` старше конфига: фикстура их проигрывает, ассерты на автора
падают.

**Замер 25.09 (воспроизводится всегда, если identify есть в окружении).**
Полная полоса `run-many`: `Test Files 5 failed | 7 passed (12)`,
`Tests 8 failed | 85 passed (93)` — `expected '<имя из окружения>' to be
'QA Bot'` в `tools-blame`, `tools-context`, `tools-history`, `tools-show`,
`mutation`; плюс на cleanup `EBUSY: resource busy or locked, rmdir <temp>`.
Единственная упавшая задача прогона — `@yadsh/dsh-git-readonly:test`.

**Доказательство герметичности.** Тот же набор со снятыми
`GIT_AUTHOR_NAME/EMAIL` и `GIT_COMMITTER_NAME/EMAIL`: `Test Files 12 passed
(12)`, `Tests 93 passed (93)`, exit 0, без скипов и без таймаутов.

**Владелец.** Карточка 290, ветка `bot/290` (8 коммитов, 7 файлов). Проверено по
дереву ветки: фикстура вырезает `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (строки 59–63),
подняты `testTimeout: 120_000` и `hookTimeout: 90_000`
(`vitest.config.ts:25–26`). Новой карточки не нужно; нужно, чтобы 290 не
осталась только с таймаут-частью: таймаут на прогретой машине не воспроизводится
вовсе, env-часть — воспроизводится всегда.

### A4. Файлы-монолиты: число выросло, а не сократилось

Порог `>1000` строк в `src`: 24 (22.09) → 23 (24.09) → **26** (этот срез).
Порог `>800`: 42 → 42 — новых файлов в бюджет не пришло, но три файла
перешагнули 1000 уже внутри бюджетных. Лидеры подросли: `qa-surface/src/types.ts`
2188 → 2210, `qa-surface/src/index.ts` 1797 → 1832,
`qa-integrations/src/client/operator-card.tsx` 1838 → 1849, и
`qa-surface/src/admin/service.ts` 1641 → **1897** (+256 за один срез).

| Файл | Строк | Владелец |
| --- | --- | --- |
| `plugins/dsh-qa-surface/src/types.ts` | 2210 | карточка 294 (ветка есть) |
| `plugins/dsh-qa-surface/src/admin/service.ts` | 1897 | карточка 294 |
| `plugins/dsh-qa-integrations/src/client/operator-card.tsx` | 1849 | карточка 295 (ветка есть) |
| `plugins/dsh-qa-surface/src/index.ts` | 1832 | карточка 294 |
| `plugins/dsh-qa-surface/src/client/QaSessionController.ts` | 1730 | карточка 294 |
| `plugins/dsh-web-fetch-authenticated/src/client/sections.tsx` | 1625 | остаток 296 |
| `plugins/dsh-qa-surface/src/accounts/store.ts` | 1546 | карточка 294 |
| `plugins/dsh-qa-integrations/src/index.ts` | 1527 | карточка 295 |
| `plugins/dsh-qa-browser/src/host/session-manager.ts` | 1506 | остаток 296 |
| `plugins/dsh-qa-surface/src/client/admin/QaAdmin.tsx` | 1495 | карточка 294 |

Распределение 26 файлов: `qa-surface` 11, `qa-integrations` 8,
`web-fetch-authenticated` 2, по одному у `jev-compaction`, `openviking-memory`,
`qa-browser`, `session-scope`, `domain-experts`. Ещё 26 файлов в коридоре
801–1200.

**Хвост бюджета лежит вне `src`.** Самый большой скрипт репозитория —
`plugins/dsh-qa-integrations/scripts/verify-package.mjs` (1417 строк), за ним
`scripts/package-hygiene.test.mjs` (1138), `scripts/release-workflow.test.mjs`
(1064), `scripts/verify-package-hygiene.mjs` (951); в коридоре 801–1200 ещё
4 скрипта. Если бюджет смотрит только в `src` и `tests`, эта группа растёт
незаметно, а `verify-package.mjs` интеграций растёт вместе с числом провайдеров.

**Владелец.** Разбивкой заняты 294 (`bot/294`: 8 коммитов, 63 файла, `types.ts`
уже разнесён на `src/types/*.ts`) и 295 (`bot/295`: 33 файла). Вне их скоупа —
`web-fetch-authenticated` и `qa-browser` (остаток P2–P3). Заметка для слияния:
294 разошлась с `main` ровно по тем файлам, которые здесь подросли
(`admin/service.ts`, `index.ts`), так что rebase-дельта неизбежна.

### A5. Бюджет размера файла: гейт в работе, но не видит байты и `scripts/`

На `main` `scripts/check-file-budget.mjs` отсутствует, в `AGENTS.md` ни правила,
ни порогов (`grep -cE 'budget|800|1200' AGENTS.md` → 0). Зато ветка `bot/292`
(1 коммит, 10 файлов) несёт скрипт с тестами и порогами `src` 800/1200,
`tests` 400/800, «сгенерированный бандл» 20 000/100 000 и списком
`legacyOverBudget` на 17 путей.

Сверка этого среза с правилами 292 — что будет, если гейт вольётся сегодня.
Скрипт из ветки запущен против этого дерева (`node scripts/check-file-budget.mjs`,
одноразово, в трек не клался): **exit 0**, `file budget verified for 1797 files
(17 legacy exemptions)` — то есть гейт зелёный в день впадения, как и задумано
автором. Попутно он же даёт три цифры этого среза: 26 исходников сверх 800
(крупнейший не-изъятый — `qa-surface/src/personal-skills/service.ts`, 1188),
17 тестов сверх 400 (крупнейший — `qa-surface/tests/integration/integration-http.test.ts`,
710) и 1 сгенерированный бандл сверх 20 000 (`qa-surface/lib/client.js`,
65 771 строк).

Дыра, из-за которой этого мало:

Две дыры, которые надо закрыть в скоупе 292, а не новой карточкой:

1. **Байты.** Порог по строкам не видит главный объём:
   `qa-surface/src/client/markdown/katex-css.ts` — 360 КБ (генерируемый ассет,
   генератор `plugins/dsh-qa-surface/scripts/generate-katex-css.mjs`),
   `qa-surface/src/client/components/QaChangelog.tsx` — 138 КБ и
   `qa-surface/src/client/styles.ts` — 123 КБ; все трое ниже порога по строкам.
   Для `QaChangelog.tsx` это не случайность, а политика: `AGENTS.md` требует
   дописывать его в каждое изменение с version plan, то есть файл растёт по
   определению. Нужен байтовый порог плюс allowlist генерируемого.
2. **`scripts/` вне обзора.** Бюджет 292 определён для каталогов `src` и `tests`;
   скрипты (`*.mjs`) не считаются, поэтому 1417-строчный `verify-package.mjs`
   из A4 гейту не виден.

**Владелец.** Карточка 292, ветка есть. Дополнить постановку этими двумя пунктами.

### A6. У `packages/*` нет verify-задачи

На `main` — как и 24.09: `verify` нет ни у одного из семи пакетов
(`audit-core`, `audit-ui`, `config`, `plugin-kit`, `plugin-log`,
`plugin-scripts`, `test-kit`), хотя четыре из них публикуются (перечислены в
`nx.json release.projects`) и везут `lib/*.d.ts`, на которые опираются 26
плагинов. Это же корень хрупкости A1: контракт «собралось → экспорты
разрешаются» у предмета зависимости отсутствует.

**Владелец.** Карточка 293, ветка `bot/293` (3 коммита, 18 файлов) несёт
`verify-package.mjs` для `audit-core`, `audit-ui`, `plugin-kit`, `plugin-log` и
общий `packages/plugin-scripts/run-verify-package.mjs`. Новой карточки не нужно.

### A7. Покрытие: измеритель в работе, глубина `packages/*` без владельца

*Инструментального покрытия как гейта нет.* Блок `coverage` — в 5 конфигах из 32
(`dsh-draft-sessions`, `dsh-qa-browser`, `dsh-qa-integrations`,
`dsh-session-audit`, `dsh-sleev`; у четырёх из пяти с `include`, то есть цифра
обрезана заранее). Корневого `test:coverage` нет, порогов нет, в CI нет.
Формулировка каталога 22.09 («не включён ни в одном vitest.config») была
неточна уже тогда — см. строку этапа 2 в разделе 4.

*Прокси-покрытие* (строки тестов `*/tests/**.test.tsx?` к строкам `src`) на
срезе: худшие — `packages/audit-ui` 31 %, `dsh-qa-browser` 32 %,
`dsh-documents` 33 %, `dsh-web-fetch-authenticated` 35 %; лучшие —
`dsh-lightrag` 80 %, `dsh-tool-offload` 83 %, `dsh-answer-review-gate` 110 %,
`dsh-l10n-overrides` 190 %. Пустых по тестам плагинов нет.

*Глубина `packages/*`* — то, из чего растёт A1: `packages/plugin-log` (база
логирования всех 26 плагинов) — 1 тест-файл на 602 строки против 1044 строк
`src`; `audit-ui` — 3 файла (649) против 2114; `test-kit` — 3 файла (157)
против 203; `audit-core` — 5 файлов (675) против 1343; `config` и
`plugin-scripts` — 0. Самый большой тест-файл в репозитории — 842 строки
(было 776), он же единственный сверх порога 800.

**Владелец.** Измеритель — карточка 291 (`bot/291`: 2 коммита, 47 файлов).
Тестовой глубине `plugin-log` / `audit-ui` / `audit-core` владелицы нет:
предлагается пунктом в скоуп 293 (там уже `verify` этих пакетов), а не новой
карточкой.

### A8. CI собирается только на Linux

`.github/workflows/ci.yml` — три job, все `runs-on: ubuntu-latest`
(строки 20, 90, 127); матрица есть, но по проектам, а не по ОС. Следствие: A2 в
CI не виден ни при каком раскладе, а поведение кэша из A1 в CI одно-worktree-ное
и потому тоже не видно.

**Владелец.** Карточка 296 (`bot/296`: 1 коммит, 1 файл) — документование
границы. Расширять матрицу каталог 22.09 сознательно не предлагал; но A1 и A2 —
не «граница», а чинимые дефекты, и в 296 их класть не надо.

### A9. Битые ссылки в документах: не 9, а 3

Замер: 192 `.md`, 124 относительные ссылки, из них неразрешимых **3**.

* `plugins/dsh-documents/docs/specs/document-pipeline.md:795` →
  `assets/login-error.png` и `:820` → `assets/image-001.png` — файлов нет;
* `plugins/dsh-qa-surface/docs/specs/sources-provenance.md:1021` →
  `../architecture.md`, в индексе лежит `docs/ARCHITECTURE.md` — ссылка
  работает только на регистронезависимой ФС, на Linux и в веб-просмотре 404.

Отдельным классом — 3 ссылки на каталог вместо файла
(`dsh-plugin-log-ui/SPEC.md:12`, `dsh-qa-integrations/SPEC.md:1655`,
`dsh-web-fetch-authenticated/README.md:5`): в ФС они разрешаются, но в
просмотрщике репозитория не открываются.

**Поправка к 24.09.** Там было записано 9: «2 + 7 регистровых». Шесть из семи
«регистровых» ложны: `docs/architecture.md` у `dsh-domain-experts` и
`dsh-draft-sessions` и `docs/compatibility.md` у `dsh-sleev` существуют в
индексе именно в нижнем регистре — проверено и на этом срезе, и на срезе
`c225c72`. Регистровый разнобой между плагинами (`qa-surface` пишет
`ARCHITECTURE.md`, остальные — строчными) реален, но это вопрос соглашения
(раздел 5, п. 4), а не сломанной ссылки; сканер, который сверяет регистр по образцу
другого плагина, а не по `git ls-files`, даёт шесть ложных срабатываний из
девяти.

**Почему обязательно.** Три адреса — это три 404 для читателя, и ни один гейт
ссылки не проверяет, поэтому класс будет возвращаться.

**Что делать.** Исправить 3 адреса; сканер (строка + регистр, по
`git ls-files`, без блоков кода) положить рядом с `check-file-budget` из A5.

**Владелец.** Новая карточка, оценка S.

## 2. Полоса проверок на этом срезе

| Команда | Результат |
| --- | --- |
| `pnpm install --prefer-offline` | exit 0 |
| `npx nx run-many -t lint typecheck test build verify --skip-nx-cache` | exit 1; задачи: lint 34, typecheck 32, test 32, build 31, verify 26; сводка vitest: 5416 passed / 8 failed / 4 skipped, тест-файлов 696 passed / 5 failed / 3 skipped; единственная упавшая задача — `@yadsh/dsh-git-readonly:test` (A3); Nx рапортовал «14 flaky tasks» |
| `env -u GIT_AUTHOR_* -u GIT_COMMITTER_* … nx run @yadsh/dsh-git-readonly:test` | exit 0, 12 файлов / 93 теста (герметичность A3) |
| `pnpm test:release` | exit 0, 193/193 (A2 воспроизводится только с standalone-pnpm, см.) |
| `pnpm verify:packages` | exit 0, «package hygiene: verified 30 publishable plugins» |
| `pnpm verify:logging` | exit 0, «plugin logging verified for 26 packages» |
| `pnpm verify:a11y` | exit 0, «296 buttons in 973 sources» |
| `pnpm format` | exit 0, «All matched files use Prettier code style!» |
| `pnpm deps:check` | exit 0, «all SPEC §27 dependency rules satisfied» |
| `pnpm lint:workspace` | exit 0 |
| `pnpm release:check` | exit 0, «0 of 30 publishable project(s) … all covered by a plan» |

Зелёной вся полоса не была: падение A3 остаётся, пока не влита 290.
`pnpm check` целиком не запускался — он попадает в тот же кэш, который чинит A1,
и отдельно воспроизводить его нет смысла: составные `run-many` прогоны выше
строже (они идут с `--skip-nx-cache`).

## 3. Структура каталогов (то, о чём прямо спрашивает карточка)

Раскладка унифицирована и не регрессировала: 0 файлов в каталогах `test/`,
0 тест-файлов внутри `src/`, 794 файла `.ts`/`.tsx` в `*/tests/` (из них 702 —
`*.test.*`). Пер-плагинная поверхность (26 плагинов):

| Элемент | Есть у | Комментарий |
| --- | --- | --- |
| `README.md`, `SPEC.md`, `CHANGELOG.md`, `tsconfig.json`, `scripts/verify-package.mjs` | 26 / 26 | норма соблюдается |
| `docs/` | 16 / 26 | нет у `answer-review-gate`, `doc-impact`, `git-readonly`, `l10n-overrides`, `lightrag`, `plugin-log-ui`, `preset-persona-editor`, `prompt-firewall`, `session-scope`, `user-correction-miner` |
| `vitest.config.ts` | 25 / 26 | нет у `dsh-ui-repair` |
| `tsdown.config.ts` | 19 / 26 | серверные плагины без клиентской сборки |
| `eslint.config.js` | 0 / 26 | конфиг один, в корне |

Последняя строка — мелкий, но реальный мусор конфигурации: `nx.json:8`
исключает `!{projectRoot}/eslint.config.js` из `namedInputs.production`, хотя
такого файла нет ни у одного проекта: исключение ничего не исключает и вводит в
заблуждение при чтении `inputs`.

Поверхность `packages/*`: `src/index.ts` есть у пяти (`config` и `plugin-scripts`
— другой вход), `CHANGELOG.md` нет у `config` и `plugin-scripts` (оба не
публикуются — корректно), `README.md` нет только у `plugin-scripts`.

## 4. Уже сделано — перепроверено на этом срезе, переоткрывать не надо

| Находка (каталог 22.09 / план 02.09) | Чем закрыто | Чем проверено сейчас |
| --- | --- | --- |
| Этап 1: `test/` → `tests/`, `dist/` → `lib/` | `4f93011` | 0 файлов в `*/test/*`, 0 тестов в `src/`, 794 файла в `*/tests/*` |
| Этап 2: tsconfig- и vitest-пресеты | `8108afd`, `6f0bfe8` | 40 конфигов наследуют `@yadsh/dsh-config/tsconfig`; инлайн-`compilerOptions` с `target`/`module` — 0; из 32 vitest-конфигов 30 — голый ре-экспорт пресета, 2 расширяют |
| Этап 5.1/5.2: test-kit оживлён, typecheck-дыры закрыты | `348bc19` | `@yadsh/dsh-test-kit` объявлен в 17 пакетах, тесты пакета идут в общей полосе |
| Этап 5.3: мегатесты l10n разнесены | `eb33ec9` | самый большой тест пакета — 374 строки (было 1273); самый большой тест в репо — 842 |
| Этап 6: `generate-typert` в `plugin-scripts` | `c3ea6d9` и волна 05.09 | 11 файлов: общий раннер 200 строк + 10 шимов по 8 строк вместо копий |
| Мелкий мусор плана 02.09 (пп. 1, 3, 4, 7) | `a989a6f` | пустых `.agents/notes/*.md` — 0, `SPEC_ dsh-*` — 0 файлов, CHANGELOG у всех 26 плагинов, `packages/config/build/` нет, README у `packages/config` есть |
| Мелкий мусор п. 2: висячее правило `.dsh/doc-impact.yml` | — | 0 висячих путей среди ссылок в `.dsh/*.yml` |
| Мелкий мусор п. 8: легаси `.eslintrc.json` в `nx.json`, версии `@swc` вне каталога | — | в `namedInputs` нет `.eslintrc.json`; devDep корня `@swc/core` и `@swc-node/register` — `catalog:tooling` |
| D4: файлы не в формате prettier | зачтено более поздней волной | `pnpm format` → exit 0 |
| D7: служебные маркеры | чисто | `TODO:`/`FIXME:` в `src` — 0, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` в `src` — 0, `.only`/`.skip` в тестах — 0, `eslint-disable` — 11 файлов (все осмысленные), `console.*` вне `src/client` — 2 файла |
| D8: идентичные src-файлы | не было и нет | md5 по 973 файлам `src` — 0 дублей |
| D11: идентичность клиентских бандлов | чисто | 19 `tsdown.config.ts` в `plugins/*`, контракт «`id` == имя пакета» проверяет per-plugin `verify-package`; в прогоне 26/26 задач `verify` зелёные |
| Гигиена публикуемых пакетов | корневые гейты | `pnpm verify:packages` — 30 publishable, `pnpm verify:logging` — 26 пакетов, `pnpm verify:a11y` — 296 кнопок в 973 исходниках |
| #250, #259 | влиты | `62521de`, `b6bd76a` — предки `288e0d6` |

## 5. Необязательное (список; карточек не требует, делается по касанию)

1. `dsh-ui-repair` — единственный плагин без `vitest.config.ts`, и его
   `test`-скрипт начинается с `pnpm run build:client`, то есть тест зависит от
   сборки (у остальных это делает Nx через `dependsOn`).
2. `smoke-packed-dsh.mjs` — 4 копии на разном весе (211 / 224 / 606 / 917
   строк): `dsh-sleev`, `dsh-session-scope`, `dsh-draft-sessions`,
   `dsh-qa-surface`. Этап 6 до них не дошёл.
3. `verify-client-bundle.mjs` — 5 копий (10 / 33 / 51 / 97 / 137 строк); общий
   раннер есть в `@yadsh/dsh-plugin-scripts`, но только для `verify-package`.
4. Регистровый разнобой имён документов: `qa-surface` держит `ARCHITECTURE.md` /
   `COMPATIBILITY.md`, остальные плагины — строчными. Выбрать соглашение и
   проехать его один раз; это же снимет ложноположительный класс из A9.
5. `files` в `package.json`: у 31 продукта поле объявлено, у 17 из них — просто
   `lib`, у остальных — явные глобы; не объявлено у `packages/config` и
   `packages/plugin-scripts` (непродукты). Дрейф с 22.09 вырос (было 17/14).
6. `nx.json:8` — мёртвое исключение `!{projectRoot}/eslint.config.js`
   (раздел 3).
7. `console.*` вне `src/client` — 2 файла (на 24.09 было 7): переводить на
   `plugin-log` по касанию.
8. `SPEC.md:234` и `docs/superpowers/specs/2026-08-31-dsh-ui-kit.md` ссылаются на
   несуществующий `packages/ui-kit`; в `docs/PLUGIN_GUIDELINES.md` упоминается
   каталог `.agents/notes/draft/`, которого в дереве нет. Исторические абзацы —
   подправить формулировку, не «чинить».
9. `docs/superpowers/plans/2026-08-31-audit-remediation-plan.md` несёт пути уже
   несуществующих файлов (`plugins/dsh-kv-persist/test/…`) — исторический
   документ, только пометить датой.

## 6. Мусор — явно не делать

1. Консолидировать 26 `verify-package.mjs`: md5-скан — все 26 уникальны, это
   пер-плагинные контракты (вывод плана 02.09 подтверждён заново).
2. Резать `katex-css.ts` (360 КБ): генерируемый ассет со своим генератором — для
   него allowlist в бюджете A5, не разрезание.
3. Трогать мелкие здоровые пакеты: `dsh-sleev`, `dsh-lightrag`,
   `dsh-answer-review-gate`, `dsh-tool-offload`, `dsh-l10n-overrides`
   (прокси-покрытие 80–190 %, файлов >800 строк нет).
4. «Разбор» покрытия по прокси-процентам как самостоятельная работа: сначала
   измеритель (291), потом решения.
5. Свип мёртвых экспортов по `packages/*` (постановка #257). Замер 25.09:
   5 бэррелей, 95 именованных экспортов, и ни одного, чьё имя не встречалось бы
   больше нигде в отслеживаемом дереве. Имя, упомянутое в чужом `import type`,
   ничем не отличается от имени, упомянутого в собственной перепродаже, — то
   есть grep не способен ни подтвердить, ни опровергнуть «мёртвость».
   Настоящий пункт здесь — «завести инструмент (`knip`/`ts-prune`) и гейт на
   него», а не свип.
6. Дробить npm-пакеты по объёму строк. Рекомендации по разбиению привязаны к
   дефекту (в одном файле несколько несвязанных причин изменения), а не к числу:
   `qa-surface` остаётся одним пакетом независимо от того, сколько строк в
   `types.ts`, и 294/295 режут файлы по границам ответственности.

## 7. Сводка цифр по срезам

| Метрика | 22.09 | 24.09 | 25.09 (этот срез) |
| --- | --- | --- | --- |
| Файлов `src` (`.ts`/`.tsx`) | — | 967 | 973 |
| Строк в них | — | — | 224 247 |
| Тест-файлов в прогоне | 655 | 675 | 704 (696 + 5 + 3 скипнутых) |
| Тестов в прогоне | 4856 passed / 6 failed | 5173 passed / 3 failed / 8 skipped | 5416 passed / 8 failed / 4 skipped |
| Упавших задач прогона | 1 (`git-readonly:test`) | 1 | 1 (`git-readonly:test`) |
| «Flaky», о которых рапортует Nx | — | 22 / 37 | 14 |
| Корневые `node:test` | зелёные | 192/193 (A2) | 193/193; A2 — условный, см. |
| `pnpm build` в дереве без `packages/*/lib` | не проверялось | не проверялось | exit 0, `lib/` не появился (A1) |
| Файлов `src` > 1000 | 24 | 23 | 26 |
| Файлов `src` > 1200 (порог гейта) | — | — | 16 |
| Файлов `src` > 800 | — | 42 | 42 |
| Максимальный тест-файл | 1273 | 776 | 842 |
| Максимальный скрипт вне `src` | — | 1417 | 1417 |
| Конфигов с `coverage` | 5 | 5 из 25 | 5 из 32 |
| Пакетов `packages/*` с `verify` | 0 из 7 | 0 из 7 | 0 из 7 |
| Битых ссылок в `.md` | не измерялось | 9 (переоценка) | 3 + 3 на каталог |
| `console.*` вне `src/client` | — | 7 файлов | 2 файла |

Отдельно про «тест-файлы 702 против 704»: это две разные метрики, а не
расхождение. 702 — файлы `*.test.tsx?` в индексе (`git ls-files`), 704 — файлы,
которые насчитал vitest по своим `include`-глобам в сводке прогона.

## 8. Разведение карточками

| Пункт | Статус на 25.09 | Действие полосе |
| --- | --- | --- |
| A1 `outputs` в `nx.json` + общий кэш worktree | владельца нет | новая карточка, S |
| A2 предпосылка «`npm_execpath` — JS-файл» | владельца нет | новая карточка, S (формулировка — не «Windows-фол») |
| A3 git-readonly env | 290, ветка есть, env-часть в ней | контролировать, чтобы env-часть не была вытеснена таймаут-частью |
| A4 монолиты `src` | 294 и 295 — обе с ветками | новых карточек не заводим |
| A4′ `verify-package.mjs` 1417 строк | входит в A5 | положить в скоуп 292 (`scripts/` вне текущих правил бюджета) |
| A5 бюджет строк и байтов | 292, ветка есть; по текущему allowlist гейт зелёный | дополнить скоуп 292: байтовый порог + allowlist генерируемого + `scripts/` |
| A6 `verify` у `packages/*` | 293, ветка есть | без новых карточек |
| A7′ измеритель покрытия | 291, ветка есть | без новых карточек |
| A7″ глубина `plugin-log` / `audit-ui` | владельца нет | пунктом в скоуп 293, не новой карточкой |
| A8 граница ОС в CI | 296, ветка есть | документация; A1/A2 в неё не класть |
| A9 битые ссылки (3) | владельца нет | новая карточка, S; сканер — вместе с бюджетом из A5 |
| Мёртвые экспорты (#257) | решения «не делать» не записано | переформулировать постановку в «инструмент + гейт» |
| Структура каталогов (раздел 3), необязательное (раздел 5), мусор (раздел 6) | — | как записано, карточек не заводим |

## 9. Как проверять результат следующего среза

Минимальный набор команд, чтобы «сделано» не пришлось перепроверять руками:

```bash
pnpm install --frozen-lockfile
npx nx run-many -t lint typecheck test build verify --skip-nx-cache --output-style=static
pnpm test:release
npm_execpath="$LOCALAPPDATA/pnpm/.tools/pnpm-exe/<версия>/pnpm.exe" \
  node --test --test-name-pattern="publishes prepared tarballs" scripts/release-workflow.test.mjs
env -u GIT_AUTHOR_NAME -u GIT_COMMITTER_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_EMAIL \
  npx nx run @yadsh/dsh-git-readonly:test --skip-nx-cache
rm -rf packages/*/lib && npx nx run-many -t build && ls -d packages/*/lib   # A1: до починки список пуст
node scripts/check-file-budget.mjs                                          # после A5
pnpm format && pnpm deps:check && pnpm lint:workspace && pnpm release:check
```

Единственная красная задача полной полосы (`git-readonly:test`) чинится в 290, и
пока 290 не влита, зелёного `run-many` на машине с git-identify в окружении не
получить: это надо держать в голове, читая отчёты полос, а не считать
регрессией.
