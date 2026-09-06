# План исправлений по результатам аудита монорепозитория

**Дата:** 2026-08-31  
**Статус:** исполнен (блоки A–E/F выпущены в сентябре 2026; целевые пункты перенесены в tracked план `.nx/version-plans/audit-remediation.md`)  
**Область:** `dsh-kv-persist`, `dsh-user-correction-miner`,
`dsh-session-scope`, CI и репозиторная гигиена

## 1. Цель и правила исполнения

Этот документ превращает два внешних отчёта об аудите в проверяемый план.
Он специально содержит достаточно контекста, чтобы следующий исполнитель не
перечитывал исходные отчёты и не повторял весь аудит.

Главные результаты, которые должны быть достигнуты:

1. Один физический llama.cpp slot нельзя переключить, стереть, сохранить или
   восстановить, пока через него ещё идёт предыдущий inference stream.
2. llama.cpp HTTP-клиент не принимает массивы и другие некорректные JSON-формы
   за успешные management-ответы.
3. KV metadata всегда попадает в тот же DSH home, что и остальные данные DSH.
4. Усечение текста miner не создаёт одиночные UTF-16 surrogate code units.
5. Host-часть `dsh-session-scope` снова реально проверяется TypeScript и ESLint.
6. PR CI запускает package-specific verify-гейты, включая контракт карточек и
   общий logging contract.

Правила работы:

- Не очищать и не сбрасывать текущее рабочее дерево. На момент составления
  плана `pnpm-workspace.yaml` и `pnpm-lock.yaml` изменены, а
  `docs/superpowers/` и `plugins/dsh-user-correction-miner/` не отслеживаются.
  Это пользовательская работа.
- Делать обязательные блоки по порядку. Особенно не начинать косметическую
  унификацию до исправления KV concurrency.
- Для каждого логического дефекта сначала добавить тест, который падает на
  старом коде, затем исправлять реализацию.
- Не выдавать зелёный общий pipeline за доказательство отсутствия логических
  дефектов: на исходном состоянии `pnpm check`, `pnpm deps:check` и
  `pnpm tarball:verify` уже проходили.
- Не менять публичную семантику без обновления README/SPEC и оценки версии.

## 2. Приоритеты

### Обязательно до следующего релиза

| Приоритет | Работа | Причина |
| --- | --- | --- |
| P0 | Сериализация KV slot на всё время стрима | Возможна порча/потеря KV состояния при параллельных запросах |
| P1 | Строгая проверка llama.cpp JSON | Некорректный `HTTP 200 + []` сейчас считается успешным restore/erase |
| P1 | Единый fallback `DSH_HOME` | Реализация противоречит README/SPEC и пишет metadata относительно cwd |
| P1 | Unicode-safe truncation miner | Сохраняются повреждённые surrogate-пары и символ `�` |
| P1 | Типизация host-части session-scope | 679 строк критичной интеграции исключены из typecheck |
| P1 | Verify-гейты в PR CI | Нарушение package/card/logging contract может попасть в main |

### Желательно после обязательного блока

| Приоритет | Работа | Причина |
| --- | --- | --- |
| P2 | Ограничение и подсчёт записей miner | Полный scan/sort и неограниченный рост таблицы |
| P2 | Ограничение live `pending` miner | Map не имеет cap/TTL и зависит от lifecycle-событий |
| P2 | Defensive clone в MemoryCorrectionStore | Асимметричный контракт тестового стора |
| P2 | Пауза UI polling | Лишние RPC в скрытой вкладке/неактивной карточке |
| P2 | Поиск Git Bash через PATH | Поддержка Scoop/portable Git |
| P2 | Удаление лишних install-time builds | Ускорение CI и локального install |
| P3 | Нормализация manifests/specs/tsconfig | Снижение дрейфа, без исправления runtime-багов |

## 3. Обязательный блок A: KV slot должен быть арендован на весь stream

### 3.1. Подтверждённая ошибка

Файлы:

- `plugins/dsh-kv-persist/src/coordinator/coordinator.ts`
- `plugins/dsh-kv-persist/src/coordinator/slot-lease.ts`
- `plugins/dsh-kv-persist/test/integration/coordinator.test.ts`
- `plugins/dsh-kv-persist/test/unit/coordinator-parts.test.ts`

Сейчас `runSessionRequest()` вызывает `SlotMutex.runExclusive()`, под mutex
подготавливает slot и возвращает `AsyncIterable`. Как только iterable
возвращён, mutex освобождён, хотя его потребление ещё не закончено.

Воспроизводимый сценарий:

1. A получает slot и отдаёт первый chunk, но stream остаётся открытым.
2. B входит в тот же mutex, видит A ещё clean, не сохраняет его, стирает slot и
   назначает владельцем B.
3. B завершается и становится dirty.
4. A завершается позже; runtime A тоже становится dirty, хотя slot уже
   принадлежит B.

Исправлять только `#onInferenceSuccess()` недостаточно: переключение уже
произошло во время открытого стрима.

### 3.2. Сначала добавить regression tests

Добавить в integration tests управляемый stream с двумя deferred barriers.

Обязательные сценарии:

1. **A открыт, B запрошен.** До завершения/отмены A downstream B не должен
   запускаться; `eraseCount`, `saveCount` и owner не должны изменяться.
2. **A успешно завершается, затем B.** После A должен выполниться dirty mark,
   затем save-before-evict A, затем назначение B.
3. **A отменён через `iterator.return()`.** Lease освобождается в `finally`, A
   не становится dirty, B продолжает работу.
4. **A завершается ошибкой.** Lease всё равно освобождается, B не зависает.
5. **Consumer получил iterable, начал чтение и бросил исключение/закрыл
   iterator.** Освобождение выполняется ровно один раз.
6. **Management work во время inference** (`checkpoint`, `restoreNow`,
   `invalidate`, idle timer) не мутирует slot параллельно stream.

Тест должен проверять не только итоговый owner, но и порядок событий backend:
`erase/restore -> inference A -> finish A -> save A -> erase/restore B -> inference B`.

### 3.3. Реализация lease

Предпочтительное решение:

1. Расширить `SlotMutex` явным `acquire(): Promise<release>` либо отдельным
   `SlotLease`, где `release()` идемпотентен.
2. Переписать `runExclusive()` поверх `acquire()`, чтобы существующие
   management-вызовы продолжили работать без дублирования mutex-логики.
3. В `runSessionRequest()` получить lease до prepare-фазы.
4. Передать release в stream wrapper.
5. В wrapper `finally`:
   - определить успешность terminal finish;
   - синхронно обновить dirty state, пока lease ещё удерживается;
   - запланировать idle checkpoint;
   - освободить lease ровно один раз.
6. При ошибке prepare/strict restore освободить lease до проброса ошибки.

Не создавать схему, где lease освобождается сразу после вызова `input.next()`:
сам `AsyncIterable` ленивый, и реальный inference обычно начинается только при
итерации.

Нужно явно решить случай «iterable получен, но никогда не начал потребляться».
Минимально допустимо задокументировать, что waterfall всегда либо потребляет,
либо закрывает iterable. Лучше получать lease на первом `next()` wrapper-а,
если это не ломает текущий момент возникновения prepare-ошибок.

### 3.4. Документация и критерии готовности

Обновить `plugins/dsh-kv-persist/SPEC.md` и комментарии в coordinator:

- Invariant должен говорить, что lease охватывает prepare, inference и
  terminal bookkeeping, а не только inference-preparation.
- `--parallel 1` не считается заменой локальной сериализации management API.

Готово, когда:

- новый overlap-тест падает до исправления и проходит после;
- во время открытого stream ни один slot-mutating backend call не выполняется;
- cancellation/error не оставляют mutex held;
- прежние resident/switch/restore/idle/circuit tests проходят.

Проверка блока:

```bash
pnpm --filter @yadsh/dsh-kv-persist test
pnpm --filter @yadsh/dsh-kv-persist typecheck
pnpm --filter @yadsh/dsh-kv-persist build
pnpm --filter @yadsh/dsh-kv-persist verify
```

## 4. Обязательный блок B: строгая форма llama.cpp responses

### 4.1. Подтверждённая ошибка

Файл: `plugins/dsh-kv-persist/src/backends/llama-cpp/client.ts`.

`isRecord()` считает массив объектом, а `parseJsonBody()` дополнительно кастит
массив к `Record<string, unknown>`. В результате `restoreSlot()` принимает
`HTTP 200` с телом `[]` как `{ success: true, nRestored: null }`; `eraseSlot()`
также считает такой ответ успешным.

### 4.2. Тесты

В tests llama.cpp client добавить таблицу ответов для каждого endpoint:

- корректный object response;
- `[]`;
- `null`;
- число/строка;
- malformed JSON;
- object с `success: false`;
- object с отсутствующими обязательными полями;
- HTTP non-200.

Отдельно протестировать timeout через fetch, который завершается только после
abort signal.

### 4.3. Реализация

1. `isRecord(value)` должен проверять `!Array.isArray(value)`.
2. `parseJsonBody()` должен возвращать `unknown` или честный union без cast
   массива к record.
3. Сохранить поддержку реального `/slots`, который может быть массивом или
   `{ slots: [...] }`; нормализацию делать только в `normalizeSlotsResponse()`.
4. Зафиксировать валидную форму каждого management endpoint:
   - save: object и явный `success: true`;
   - restore: object, не `success: false`, корректный optional `n_restored`;
   - erase: определить по фактическому llama.cpp контракту, допускается ли
     пустое body при HTTP 200. Массив никогда не считать валидным ответом.
5. Если сработал внутренний timeout, оставлять общий error class
   `KvBackendUnavailableError`, но писать точное сообщение
   `request timed out after <N>ms`, а не `server is unreachable`.
6. Сетевые ошибки продолжать описывать как unreachable и сохранять `cause`.

Не добавлять новую публичную error taxonomy только ради этого исправления.

### 4.4. Критерии готовности

- `HTTP 200 + []` отклоняется restore и erase.
- Валидные варианты разных llama.cpp builds продолжают приниматься.
- Timeout и connection failure различимы в логах.
- Fail-open/circuit-breaker coordinator tests не ломаются.

## 5. Обязательный блок C: единый DSH home для KV metadata

Файлы:

- `plugins/dsh-kv-persist/src/service.ts`
- `packages/plugin-log/src/dsh-home.ts`
- tests KV service/config
- KV README и SPEC при необходимости

Реализация:

1. Импортировать публичный `resolveDshHome()` из
   `@yadsh/dsh-plugin-log`; зависимость уже существует.
2. Разрешать metadata path так:
   - непустой `config.metadata.path` — абсолютный явный override;
   - иначе `join(resolveDshHome(env), "cache", "dsh-kv-persist")`.
3. Убрать `process.cwd()` fallback из production-кода и комментариев.
4. Для детерминированных тестов разрешить передать env в
   `resolveMetadataDir(config, env = process.env)` или инъецировать DSH home.

Тесты:

- явный metadata path выигрывает;
- заданный `DSH_HOME` используется;
- blank/missing `DSH_HOME` даёт `<homedir>/.dsh/cache/dsh-kv-persist`;
- cwd не влияет на результат;
- Windows и POSIX paths нормализуются через `path` API.

Критерий готовности: реализация, README и SPEC описывают один и тот же fallback.

## 6. Обязательный блок D: Unicode-safe truncation в miner

Файлы:

- `plugins/dsh-user-correction-miner/src/mining/sanitize.ts`
- `plugins/dsh-user-correction-miner/src/mining/context-extractor.ts`
- новый общий helper, если это уменьшает дублирование
- tests sanitizer/context extractor

Подтверждённые примеры старого поведения:

- `boundText("😀abc", 2)` создаёт `"\ud83d…"`;
- byte truncation также может завершиться после high surrogate и при UTF-8
  кодировании получить replacement character `�`.

Реализация:

1. Сделать один helper для безопасного обхода Unicode code points. Не
   выполнять бинарный поиск по UTF-16 index.
2. Character limit должен считать code points, а не code units, и резервировать
   место под `…`, если текст усечён.
3. Byte limit должен накапливать `Buffer.byteLength(segment, "utf8")` и заранее
   резервировать 3 байта под UTF-8 ellipsis.
4. Если весь бюджет меньше 3 байт — вернуть пустую строку. Если бюджет не
   меньше 3, но ни один исходный code point не помещается — вернуть `…`, чтобы
   усечение не было невидимым.
5. Минимальный acceptance criterion — никогда не разделять surrogate pair.
   Сохранение целых grapheme clusters через `Intl.Segmenter` желательно, но не
   должно блокировать исправление, если усложняет детерминированность.

Тест-матрица:

- ASCII без усечения и с усечением;
- BMP кириллица;
- emoji вне BMP;
- несколько emoji на границе;
- combining mark;
- пустой текст, нулевой/малый budget;
- итоговый `Buffer.byteLength` никогда не превышает maxBytes;
- в результате нет code units диапазона lone surrogate;
- context event получает `…`, когда событие усечено до нулевого payload, но
  ellipsis помещается.

После изменения обновить описание `maxStoredTextChars`/`maxContextBytes`, если
там обещается конкретная единица измерения.

Проверка блока:

```bash
pnpm --filter @yadsh/dsh-user-correction-miner check
```

## 7. Обязательный блок E: вернуть type safety в dsh-session-scope host

Файлы:

- `plugins/dsh-session-scope/src/index.ts`
- при необходимости новый `src/host-types.ts` или `src/upstream-types.d.ts`
- `eslint.config.js`
- session-scope tests

Эта работа не должна одновременно превращаться в архитектурный rewrite.

Порядок:

1. Выписать минимальные structural interfaces только для реально используемых
   host services: sandbox policy, session, fs, remote/gateway и logger.
2. Типизировать `patchResolve()` через локальный `SandboxPolicyServiceLike`:
   сохранить точную сигнатуру `resolve`, request и возвращаемого policy.
3. Типизировать lifecycle callbacks и Cordis access points узкими interfaces;
   не заменять всё на `any`.
4. Удалить `// @ts-nocheck` из `src/index.ts`.
5. Исправить реальные compiler errors.
6. Удалить специальное отключение `ban-ts-comment` для этого файла из
   `eslint.config.js`.
7. Только после зелёного host typecheck рассматривать замену `export *` на
   явные exports. Не делать это без фактической коллизии или необходимости
   стабилизировать public API.

Отдельная желательная подзадача:

- `src/client.ts` тоже содержит `@ts-nocheck` и полностью игнорируется ESLint.
  Для него добавить browser/module-loader declarations и мигрировать отдельно;
  не смешивать с host-фиксом, если это раздувает PR.

Тесты и критерии:

- `src/index.ts` проверяется strict TypeScript без suppression;
- monkey-patch ставится и восстанавливается с прежней семантикой;
- существующие scope visibility/delegation/process/sandbox tests проходят;
- generated declarations не теряют текущие public exports;
- packed entry импортируется.

Проверка блока:

```bash
pnpm --filter @yadsh/dsh-session-scope lint
pnpm --filter @yadsh/dsh-session-scope typecheck
pnpm --filter @yadsh/dsh-session-scope test
pnpm --filter @yadsh/dsh-session-scope build
pnpm --filter @yadsh/dsh-session-scope verify
```

## 8. Обязательный блок F: verify-гейты в pull request CI

Файлы:

- `.github/workflows/ci.yml`
- `package.json` только если нужен удобный отдельный script
- `nx.json` только если target dependency требует корректировки

Текущий CI запускает affected `lint typecheck test build`, но package-specific
`verify` отсутствует. Generic tarball verification не проверяет canonical
plugin-card CSS/SVG и не запускает `verify-plugin-logging`.

Изменения:

1. Добавить `verify` к affected targets:

   ```bash
   pnpm nx affected -t lint typecheck test build verify \
     --base="$NX_BASE" --head="$NX_HEAD"
   ```

2. Добавить отдельный шаг `pnpm verify:logging`. Этот gate сканирует все
   plugin manifests/sources и не является обычным Nx project target.
3. Сохранить affected tarball verification после package verify.
4. Не заменять PR pipeline полным `pnpm check`, если affected execution даёт
   достаточное покрытие и заметно быстрее.
5. Проверить, что UI packages действительно вызывают общий
   `verifyPluginCardContract()` из своих verify scripts.

Acceptance criteria:

- намеренное повреждение canonical card CSS валит PR verify;
- unscoped ModuleLoader registration ID валит package verify;
- удаление host logger import/dependency валит logging step;
- обычное изменение non-UI пакета не запускает нерелевантный visual/browser
  smoke, но запускает его package verify;
- release workflow остаётся без изменений по смыслу и продолжает выполнять
  полный `pnpm check` перед публикацией.

## 9. Желательный блок G: масштабирование и lifecycle miner

### 9.1. Count без сортировки

Файлы: miner `types.ts`, `dsh/storage.ts`, `dsh/commands.ts`, tests.

1. Добавить `CorrectionStore.countCorrections(workspaceKey): number`.
2. Domain implementation может сначала делать O(n) filter, но не должна
   materialize records и сортировать их.
3. Memory implementation считает подходящие Map values.
4. Status command использует `countCorrections`, а не
   `list(..., Number.MAX_SAFE_INTEGER).length`.

Не обещать индекс, пока не подтверждён API `dsh-storage-domain`.

### 9.2. Retention

Согласовать и добавить `maxRecordsPerWorkspace` либо глобальный cap. При
вставке новой записи удалять самые старые сверх лимита. Это изменение
публичной конфигурации и durable behavior, поэтому обновить README/SPEC и
добавить tests для нескольких workspaces.

Если storage-domain не позволяет эффективное удаление по workspace, сначала
зафиксировать ограничение/ADR, а не строить самодельный индекс без миграции.

### 9.3. Pending live sessions

Для `CorrectionMinerEngine.pending`:

- добавить общий cap на session IDs и events per session;
- хранить время последнего события и удалять просроченные записи;
- очищать Map при dispose плагина;
- логировать bounded warning/metric при eviction;
- сохранить обработку `turn/end` и `session/disposed`.

Тесты: зависшая сессия, отсутствие `turn/end`, поздний dispose, cap eviction,
нормальный live turn.

### 9.4. Defensive cloning

`MemoryCorrectionStore.getCursor()` должен возвращать `structuredClone` либо
весь Memory store нужно явно объявить unsafe test double. Предпочтительно
клонировать и добавить тест «мутация результата не меняет повторное чтение».

## 10. Желательный блок H: небольшие эксплуатационные улучшения

### 10.1. UI polling

Файлы:

- `plugins/dsh-plugin-log-ui/src/client/index.tsx`
- `plugins/dsh-prompt-firewall/src/client/index.tsx`

Минимум: при `document.hidden` не выполнять periodic inspect и обновлять сразу
после `visibilitychange` обратно в visible.

Polling закрытой карточки обсуждаем отдельно: badge показывает live status,
поэтому полное отключение при `open === false` может быть нежелательным.
Допустимый компромисс — более редкий interval в закрытом состоянии.

Не менять canonical outer card shell CSS/markup. После UI-изменения выполнить
package verify; визуальная проверка нужна только если затронут layout.

### 10.2. Git Bash discovery

Файл: `scripts/run-bash.mjs`.

Порядок поиска на Windows:

1. Явный opt-in env, если будет добавлен (`DSH_BASH_PATH`).
2. Git Bash в `PATH`/`where.exe`, при этом не спутать его с WSL launcher, если
   shell scripts зависят от MSYS paths.
3. `ProgramFiles/Git/bin/bash.exe` и `usr/bin/bash.exe`.
4. Понятная ошибка со списком проверенных вариантов.

Добавить unit test функции discovery с injectable platform/env/filesystem.

### 10.3. Timeout diagnostics

Включено в блок B. Не создавать отдельный error hierarchy; достаточно точного
event/message и сохранённого cause.

## 11. Желательный блок I: install/build и package hygiene

Этот блок выполнять отдельными небольшими PR после runtime-исправлений.

### 11.1. Lifecycle scripts

Проверить чистый checkout командой `pnpm install --frozen-lockfile` после
удаления `prepare` только в контролируемой временной копии/worktree.

Кандидаты:

- `packages/plugin-log`: сейчас `prepare` и `prepack` оба собирают пакет;
- `dsh-draft-sessions`, `dsh-l10n-overrides`, `dsh-sleev`: `prepare` запускает
  `tsdown + tsc` на install.

Цель: install устанавливает зависимости, Nx строит workspace по графу,
`prepack`/release gates гарантируют готовый tarball. Не удалять `prepare`, если
он нужен установке пакета напрямую из Git; сначала решить, поддерживается ли
такой способ установки.

### 11.2. doc-impact manifest

Подтверждённые policy gaps:

- отсутствует `compatibility.json`;
- отсутствует canonical `./package.json` export;
- `LICENSE` не указан в `files`, хотя npm автоматически кладёт его в tarball;
- host output `dist/`, client output `lib/` отличается от нового layout.

Действия:

1. Добавить и проверять `compatibility.json`.
2. Добавить `./package.json` export.
3. Явно добавить `LICENSE` в whitelist для читаемости политики.
4. Не мигрировать `dist -> lib` автоматически. Сначала проверить все scripts,
   exports, smoke tests и release history. Это consistency cleanup, не runtime
   bug.
5. Усилить общий package gate так, чтобы mandatory файлы проверялись одинаково
   для всех publishable plugins, а не только локальным verifier нового miner.

### 11.3. Types layout

Не заставлять host-only tsc packages использовать `lib/types/index.d.ts`.
Разрешить и документировать два корректных шаблона:

- plain `tsc`: `lib/index.js` + `lib/index.d.ts`;
- bundled multi-entry/client package: `lib/*.js` + `lib/types/**/*.d.ts`.

Главное — exports указывают на существующие файлы и tarball smoke проходит.

### 11.4. Node/browser tsconfig

`packages/config/tsconfig/node.json` и `browser.json` сейчас не используются.
Минимальный осмысленный шаг:

- KV, miner, plugin-log и другие plain Node packages перевести с generic base
  на `/tsconfig/node`, если NodeNext не вскрывает несовместимые imports;
- browser/mixed packages либо перевести на `/browser`, либо оставить их
  явные configs и удалить обещание, что shared configs каноничны;
- generator template должен выдавать config по типу плагина.

Все изменения делать только при зелёных typecheck/build/declaration tests.

### 11.5. Engines и SPEC names

Не менять engines по одному пакету без решения общей минимальной версии Node.
Сначала выбрать policy:

- реальная поддержка Node 20/22; или
- канонический baseline `^22.19.0 || >=24.0.0`.

После решения обновить manifests, compatibility files, guidelines и gate одной
серией. Переименование старых `SPEC_ ...` и будущих design docs — отдельная
механическая уборка со ссылками.

## 12. Желательный блок J: private plugin-kit cleanup

`packages/plugin-kit` private и не используется production plugins;
`test-kit` только реэкспортирует его legacy logger. Поэтому это не релизный
блокер.

В отдельном PR выбрать один путь:

1. Удалить неиспользуемые `createLogger`, `satisfiesVersion`, `validateConfig`
   и соответствующий реэкспорт; или
2. Сохранить API и исправить контракт:
   - переименовать major-only проверку в `hasCompatibleMajor`, либо реализовать
     настоящий minimum semver;
   - `validateConfig` не должен принимать `null` для object field;
   - убрать утверждение, что console prefix logger является каноническим
     production logging mechanism.

Не добавлять semver dependency, пока функция private и фактически не нужна.

## 13. Что сознательно не исправлять

Следующие пункты исходных отчётов не являются задачами этого плана:

- `managed-slots` якобы принимается молча — режим уже отклоняется config resolver.
- `complete` якобы отключает prompt firewall через пользовательский ввод — это
  совместимость с upstream replacement semantics и покрыто тестами.
- Несколько TypeScript majors сами по себе не являются дефектом.
- `plugin-kit` и `test-kit` не нужно добавлять в Nx release: они private.
- Не объединять разные `normalizeWorkspacePath`: один работает с absolute
  workspace identity, другой валидирует relative path.
- Не объединять Schemastery, Zod и ручную валидацию в один helper без анализа
  границ: они используются для разных контрактов.
- Не дробить coordinator или DOM translator только из-за количества строк.
- Не выносить safety-селекторы l10n-overrides в пользовательский config без
  threat/product анализа.
- `clean` preset prompt-firewall намеренно содержит известные noisy sections;
  отсутствие этих секций у пользователя безвредно.
- Не менять generator ModuleLoader test: он уже требует full scoped package
  name и проверяет отсутствие unscoped ID. Устарел только старый l10n plan.
- Не считать отсутствующий `LICENSE` в `files` доказательством отсутствия
  лицензии в tarball: npm включает её автоматически. Улучшать нужно единый gate.
- Не запускать реальный llama-server или внешний LLM в обычном CI. llama test
  остаётся opt-in; sleev integration использует scripted adapter.

## 14. Рекомендуемая разбивка на PR/коммиты

Не собирать всё в один PR.

1. **KV correctness PR**
   - overlap regression test;
   - stream-scoped slot lease;
   - llama response validation;
   - DSH home fallback;
   - KV docs/tests.
2. **Miner correctness PR**
   - Unicode-safe truncation;
   - затем count/retention/pending отдельными commits, если scope согласован.
3. **Session-scope type safety PR**
   - host types и удаление host `@ts-nocheck`;
   - client suppression — отдельный follow-up при необходимости.
4. **CI enforcement PR**
   - affected verify;
   - global logging gate;
   - тест/доказательство plugin-card failure.
5. **Repository hygiene PR(s)**
   - install lifecycle scripts;
   - package manifests/gates;
   - tsconfig adoption;
   - engines/spec naming/docs.

Для publishable behavior fixes подготовить Nx version plan согласно release
policy. Не создавать version plan для чисто локальной аналитики до решения,
какие изменения реально войдут в релиз.

## 15. Финальная проверка всей серии

После каждого PR запускать package-local checks. Перед итоговой передачей всей
серии обязательно:

```bash
pnpm check
pnpm deps:check
pnpm tarball:verify
```

Дополнительно:

```bash
pnpm verify:logging
pnpm nx run-many -t verify
git status --short
```

Ожидания:

- lint, strict typecheck, unit/integration tests и builds зелёные;
- все package-specific verify scripts зелёные;
- dependency boundaries зелёные;
- все publishable tarballs устанавливаются и импортируются;
- client bundles регистрируются полным scoped `package.json.name`;
- canonical plugin-card contract остаётся неизменным;
- рабочее дерево не содержит случайно перезаписанных пользовательских файлов;
- opt-in tests с реальным llama-server явно отмечены как не запускавшиеся,
  если `DSH_KV_TEST_LLAMA_URL` не был предоставлен.

## 16. Definition of done

Работа считается завершённой только если:

1. Все шесть обязательных блоков имеют regression tests.
2. Параллельный A/B stream больше не может переключить slot до terminal
   completion/cancellation A.
3. Некорректные llama responses не превращаются в success outcomes.
4. KV metadata path совпадает с documented DSH home convention.
5. Miner не создаёт lone surrogates ни при char-, ни при byte-limit.
6. Host `dsh-session-scope/src/index.ts` не содержит `@ts-nocheck` и проходит
   strict typecheck.
7. PR CI исполняет affected package verify и global logging contract.
8. README/SPEC отражают фактическое поведение.
9. Все команды финальной проверки прошли, либо конкретный пропуск и причина
   явно записаны в handoff.

