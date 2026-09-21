# SPEC: `providers/testit`

## Status

Реализовано (read-only MVP), вживую против реальной инсталляции Test IT не
проверялось. Список того, что нужно подтвердить живым стендом, — в разделе
[«Открытые вопросы»](#открытые-вопросы).

## Goal

Реализовать provider `testit` для integration layer `qa-surface`: агент читает
тест-библиотеку, тест-планы, прогоны и результаты Test IT **от имени владельца
подключённого API-токена**, не получая сам токен и не имея возможности выбрать
чужое подключение.

MVP — read-only:

- проекты и разделы тест-библиотеки;
- тест-кейсы, чек-листы и общие шаги: список и полная карточка;
- история изменений и комментарии тест-кейса;
- тест-планы, карточка и сводка по тест-поинтам;
- прогоны, карточка прогона и результаты прогона;
- отдельный результат теста, история результатов тест-кейса;
- метаданные вложений и текст небольшого текстового вложения;
- автотесты проекта и карточка автотеста;
- конфигурации проекта.

Запись (комментарии, правка тест-кейсов, запуск прогонов, загрузка вложений) —
следующая стадия: она требует confirmation-фреймворка, которого в пакете пока
нет ни у одного провайдера.

## Context

`qa-surface` user — security principal. Provider не доверяет identity,
переданной моделью:

```text
authenticated qa-surface user
    ↓
owned DSH session
    ↓
qa-surface.principalForSession(sessionId)
    ↓
qa-integration-broker (broker.ts)
    ↓
запись подключения пользователя + расшифровка credential (секрет-стор)
    ↓
providers/testit
    ↓
Test IT Open API v2
```

Ни один тул не принимает `userId`, `credentialId`, `integrationId`,
`instanceId`, `baseUrl` или `token`: выбор подключения живёт в форме
подключения (RPC хоста), а не в аргументах инструмента. Это проверяет гейт
пакета и свип `tests/tools-security.test.ts` по всем тулам сразу.

Платформенные предпосылки из исходной постановки (binding сессии к
пользователю, зашифрованное хранилище credential, реестр провайдеров, аудит,
SSRF-граница) в этом репозитории **уже реализованы общим слоем**
(`broker.ts`, `repository.ts`, `secrets/**`, `providers/registry.ts`), поэтому
провайдер их не дублирует и не создаёт своих таблиц.

## Authentication

```http
Authorization: PrivateToken <token>
```

- Токен едет только в заголовке. Ни URL, ни query, ни тело, ни лог, ни
  сообщение об ошибке его не содержат; тест `testit.test.ts` это пинит.
- Форма токена Test IT не документирует, поэтому проверяется только то, что
  ловит ошибку вставки: `^\S{16,4096}$` и запрет URL-подобной строки
  (как у TeamCity).
- Токен лежит в общем секрет-сторе пакета (`secrets/secret-store.ts`,
  AES-256-GCM, per-record DEK), вместе с `instanceId` — идентификатором
  инсталляции, для которой он выпущен. Базы токен не покидает: запись
  подключения хранит только `secretRef`.
- `validate` — read-only и использует документированный первый запрос
  `GET /api/v2/projects?Take=1`: успешный авторизованный ответ доказывает и
  адрес, и токен. Пустой список проектов — валидный результат авторизации, а не
  ошибка.
- **Владельца токена API v2 не сообщает**: эндпоинта `/me`, `GET /users/{id}`
  или подобного в спецификации нет (есть только
  `GET /api/v2/users/exists?userName=` — проверка доступности имени). Поэтому
  подключение хранит `externalUserId = ""`, а карточка не показывает
  «аккаунт»: `displayName` описывает то, что доказала проба
  (`<label инсталляции> · Test IT API v2, проектов видно: N`), а не личность.
  Никакой операции с «mine»-дефолтом у провайдера нет.

## API base и совместимость версий

- База: `<baseUrl>/api/v2`; `baseUrl` — канонизированный адрес инсталляции из
  конфига оператора.
- Test IT поставляется как Cloud (`<team>.testit.software`) и как on-prem TMS;
  официальные клиенты публикуют матрицу совместимости «Test IT ↔ версия
  клиента». Провайдер не привязан к сгенерированному клиенту: он говорит с
  документированными эндпоинтами напрямую, чтобы версия инсталляции не
  превращалась в версию зависимости.
- **Эндпоинта версии сервера в API v2 нет** (проверено по OpenAPI-спеке
  официального клиента). Значит, capability negotiation невозможен: набор
  инструментов объявляется целиком, а отсутствующий на конкретной инсталляции
  эндпоинт отвечает `404 → ResourceNotFound`. Это осознанный выбор в пользу
  честной ошибки вместо угадывания версии.
- Ответы разбираются терпимо: проекции берут только те поля, которые нужны, и
  не падают на новых свойствах (в тестах есть поле
  `unknownFieldFromANewerServer`, которого нет в проекции).

## Структура provider

```text
src/providers/testit/
  index.ts        TestitProvider: parseCredential / validate / execute
  catalog.ts      возможности (capability ↔ флаг) и операции (operation ↔ GET-путь)
  operations.ts   построение запросов, лимиты, проекции ответов, конверты списков
  transport.ts    HTTP-граница: PrivateToken, страницы, таймаут, лимит размера
  config.ts       список инсталляций (SSRF-граница), флаги, бюджеты
  attachments.ts  политика видов вложений и бюджет чтения
  tools.ts        model-visible тулы провайдера
```

## Инсталляции и адресная политика

Test IT бывает облачный и self-hosted, поэтому адрес — поле, чувствительное к
SSRF. Граница проведена так же, как у GitLab/Jira/Confluence: **оператор
объявляет список инсталляций**, а форма подключения выбирает из него.

```yaml
testit:
  instances:
    - id: cloud
      label: Test IT Cloud
      baseUrl: https://team.example.testit.software
    - id: tms
      label: TMS стенда
      baseUrl: https://tms.example.internal
  allowInsecureHttp: false
```

- Адрес никогда не приходит из тула и не хранится в credential: он
  перечитывается из конфига на каждом вызове, поэтому удаление или
  переадресация инсталляции закрывает уже созданные подключения, а не только
  будущие (тест «re-resolves the address from config on every call»).
- Только `https://`, кроме `allowInsecureHttp: true` — осознанной лазейки для
  внутреннего стенда. Запрещены credentials в URL, query и фрагмент; путь
  сохраняется, хвостовой слэш снимается.
- Опечатка оператора падает на загрузке конфига, а не молча выбрасывает
  инсталляцию.
- **Отличие от исходной постановки**: она предлагала отдельно отбивать
  loopback/link-local/метаданные и приватные диапазоны RFC1918 по умолчанию, с
  админским флагом `allowPrivateProviderHosts`. Здесь этого нет: у Test IT
  внутренний адрес — норма (on-prem TMS), а список оператора и есть allowlist
  исходящих направлений, поэтому «приватность» адреса ничего не добавляет к
  безопасности, зато ломает штатный сценарий. Ограничение egress — задача
  сетевой политики стенда (как и для остальных провайдеров), а не
  per-provider проверки CIDR.

## Capability model

Возможность существует для пользователя, когда её включил **оператор** (флаг
развёртывания) — Test IT остаётся последней инстанцией авторизации и отказывает
сам. Сужения по «выданным правам» нет: API v2 не сообщает права токена, поэтому
`validate` возвращает ровно тот набор, который разрешил стенд.

| Capability | Флаг | Что открывает |
|---|---|---|
| `projects.read` | `projectsRead` | Список проектов, карточка проекта, проба подключения |
| `sections.read` | `sectionsRead` | Разделы (папки) тест-библиотеки |
| `workItems.read` | `workItemsRead` | Тест-кейсы, чек-листы, общие шаги |
| `history.read` | `historyRead` | История изменений тест-кейса |
| `comments.read` | `commentsRead` | Комментарии тест-кейса |
| `testPlans.read` | `testPlansRead` | Тест-планы, карточка, сводка |
| `testRuns.read` | `testRunsRead` | Прогоны и карточка прогона |
| `testResults.read` | `testResultsRead` | Результаты прогона, результат, история результатов |
| `autoTests.read` | `autoTestsRead` | Автотесты и карточка автотеста |
| `attachments.read` | `attachmentsRead` | Метаданные вложений и текст текстовых файлов |
| `configurations.read` | `configurationsRead` | Конфигурации проекта |

Дефолт политики — `deny` (общий слой): пользователь включает нужные галочки в
карточке, а выключенный оператором флаг не включается вовсе.

## Tool surface

Один тул = одна операция каталога. Всего 22.

| Tool | Capability | Метод и путь |
|---|---|---|
| `testit_connection_get` | `projects.read` | `GET /projects?Take=1` |
| `testit_projects` | `projects.read` | `GET /projects` |
| `testit_project_get` | `projects.read` | `GET /projects/{id}` |
| `testit_sections` | `sections.read` | `GET /projects/{projectId}/sections` |
| `testit_work_items` | `workItems.read` | `GET /projects/{projectId}/workItems` |
| `testit_work_item_get` | `workItems.read` | `GET /workItems/{id}` |
| `testit_work_item_history` | `history.read` | `GET /workItems/{id}/history` |
| `testit_work_item_comments` | `comments.read` | `GET /workItems/{id}/comments` |
| `testit_work_item_test_results` | `testResults.read` | `GET /workItems/{id}/testResults/history` |
| `testit_test_plans` | `testPlans.read` | `GET /projects/{projectId}/testPlans` |
| `testit_test_plan_get` | `testPlans.read` | `GET /testPlans/{id}` |
| `testit_test_plan_summary` | `testPlans.read` | `GET /testPlans/{id}/summaries` |
| `testit_test_runs` | `testRuns.read` | `GET /projects/{projectId}/testRuns` |
| `testit_test_run_get` | `testRuns.read` | `GET /testRuns/{id}` |
| `testit_test_run_results` | `testResults.read` | `GET /testRuns/{id}/testPoints/results` |
| `testit_test_result_get` | `testResults.read` | `GET /testResults/{id}` |
| `testit_test_result_attachments` | `attachments.read` | `GET /testResults/{id}/attachments` |
| `testit_attachment_metadata` | `attachments.read` | `GET /attachments/{id}/metadata` |
| `testit_attachment_text` | `attachments.read` | `GET /attachments/{id}` (байты, через `/metadata`) |
| `testit_auto_tests` | `autoTests.read` | `GET /autoTests` |
| `testit_auto_test_get` | `autoTests.read` | `GET /autoTests/{id}` |
| `testit_configurations` | `configurations.read` | `GET /projects/{projectId}/configurations` |

Свободный текст запроса (`query`) применяется к **возвращённой странице**, а не
уходит наверх: словарь `SearchField`/`SearchValue` в API v2 не документирован, и
угадывание имени колонки стоило бы 400 на каждый поиск. Так же сделано у
TeamCity, и об этом сказано в описаниях тулов.

## Почему каталог только из GET, и что из-за этого недоступно

Инвариант пакета «каждая операция каталога — GET» — это то, чем read-only
поверхность доказывается машинно (гейт падает на `method: "POST"` и на
запрещённые сегменты пути). У Test IT часть чтений доступна только через POST:

| Хотелось бы | Реальность API v2 | Что вместо |
|---|---|---|
| Поиск тест-кейсов с фильтрами | `POST /workItems/search` (тело необязательно) | `testit_work_items` (GET-список проекта) + фильтры по странице |
| Статистика прогона | `POST /testRuns/{id}/statistics/filter` | `testit_test_run_results` (тест-поинты с итогом) и `testit_test_plan_summary` |
| Статистика результатов | `POST /testResults/statistics/filter` | `testit_work_item_test_results`, `testit_test_run_results` |
| Глобальный поиск | `POST /search/globalSearch` | нет: инструмент не заводится |
| Список результатов тестов | `GET`-списка нет вообще | результаты прогона и история результатов тест-кейса |
| История результатов автотеста | `POST /autoTests/{id}/testResults/search` | `testit_work_item_test_results` (по тест-кейсу) |

Три используемых GET-списка Test IT помечает `deprecated`:
`GET /projects`, `GET /projects/{projectId}/workItems`, `GET /autoTests`. Они
оставлены, потому что это единственные GET-чтения этих коллекций; версия,
которая их уберёт, ответит `404`, и модель увидит честное «здесь это
недоступно», а не выдуманные данные.

## Пагинация, лимиты и бюджеты

- Списки, которые пагинирует сам Test IT, ходят через `Skip`/`Take` (имена
  параметров — как в OpenAPI: с большой буквы; ASP.NET связывает их
  без учёта регистра).
- Итог берётся из заголовка `Pagination-Total-Items`. Заголовки читаются
  по отдельности: инсталляция, которая сообщает только total, всё равно
  говорит, где конец коллекции. Без total конверт честно пишет
  `hasMore: true` для полной страницы — «может быть, есть ещё».
- Коллекции, которые Test IT отдаёт целиком (разделы-не-пагинируемые,
  комментарии, тест-планы проекта, сводки, результаты прогона, вложения
  результата, конфигурации), провайдер режет сам и ставит `truncated: true`.
- Дефолтный лимит — `defaultResults` (20), жёсткий потолок — `maxResults` (100),
  плюс собственный потолок коллекции (`testRuns` — 50). Запрошенный лимит
  зажимается, а не отклоняется: «дай 5000 прогонов» получает 50, а не ошибку.
- Конверт списка один на все тулы: `{ items, pagination: { offset, limit,
  returned, total?, hasMore } }`, у «целых» коллекций — `{ items, pagination,
  { limit, returned }, truncated }`.

## Недоверенный контент

Имена, описания, шаги, комментарии, сообщения и трейсы — текст, написанный
людьми и тестовым инструментарием. Он не может влиять на политику и не должен
читаться как инструкция, поэтому:

- длинный текст приходит не «голой» строкой, а блоком
  `{ format: "plain", text, totalChars, truncated }` — в ключе
  `untrustedContent` (описание, комментарий, трассы) или в текстовых полях шага
  (`action`, `expected`, `testData`, `comments`);
- короткие идентифицирующие поля (имя, id, статус, теги) остаются строками, но
  ограничиваются по длине;
- описания тулов прямо говорят, что это `untrusted external content`, а
  `tests/testit-catalog.test.ts` требует это для каждого текстового тула.

## Вложения

Вложение — единственное место, где модель просит байты, поэтому оно ограничено
дважды: политикой видов и бюджетом.

- Сначала читается `GET /attachments/{id}/metadata`. Имя и размер берутся
  **оттуда**, а не из аргументов вызывающего: описать файл иначе, чтобы
  протащить его в контекст, нельзя.
- Архивы, изображения, документы, медиа и ключевой материал отбиваются по
  расширению до запроса байтов (тот же приём, что у артефактов TeamCity).
- Файл, который Test IT уже описал как больший бюджета, отбивается по
  заявленному размеру — до скачивания (`ResultTooLarge`).
- Тело читается ограниченно, с таймаутом `attachmentTimeoutMs`, и проходит
  `redactSecrets`: лог теста может везти `password=…`.
- Бинарное тело (по content-type или NUL-байту) отвечает `binary: true` и
  размером без содержимого.
- Лимиты: `defaultAttachmentBytes` 256 KiB, `maxAttachmentBytes` 10 MiB.

## Обработка ошибок

Доменные коды — общие для пакета (`errors.ts`), наружу не уходит ни тело
ответа, ни токен:

| Upstream | Код |
|---|---|
| 400 / 409 / 422 | `InvalidRequest` |
| 401 | `CredentialRevoked` |
| 403 | `ProviderPermissionDenied` |
| 404 | `ResourceNotFound` |
| 413 | `ResultTooLarge` |
| 429 | `RateLimited` |
| 5xx | `ProviderUnavailable` |
| таймаут | `UpstreamTimeout` |
| ошибка TLS | `TlsFailure` |
| ответ больше `maxResponseBytes` | `ResultTooLarge` |
| операция вне каталога | `InvalidRequest`, без запроса наверх |
| нет principal / нет подключения / политика `deny` | `PrincipalNotResolved` / `IntegrationNotConnected` / `OperationDeniedByPolicy` |

## Повторы и таймауты

- Таймаут JSON-чтения — общий `timeoutMs` (15s), у скачивания вложения свой
  (30s).
- Повторы (`retries`, дефолт 2) — только для 429 и 5xx и сетевых сбоев, с
  `Retry-After` и экспоненциальной задержкой; `UpstreamTimeout` не повторяется,
  а 403/404 не повторяются никогда (тест это пинит).
- Мутаций у провайдера нет, поэтому вопроса об идемпотентности записи не
  возникает.
- Circuit breaker из исходной постановки **не реализован**: у остальных
  провайдеров пакета его тоже нет, а вводить его одному провайдеру — значит
  разойтись с общей механикой `providers/shared/http.ts`.

## Кэш

Кэша нет. Если он появится, ключ обязан быть
`testit:{qa_user_id}:{integration_account_id}:{resource}:{resource_id}` —
без глобальных ключей вида `testit:workItem:123`; кросс-пользовательская
дедупликация запрещена.

## Аудит

Пишет общий слой: `broker.call` фиксирует операцию, результат
(`success|denied|error`) и id сессии; `credential.connect/validate/disconnect` —
отдельные записи. Токена, тел ответов и полного текста тест-кейсов в аудите нет
по построению — аудит хранит только перечисленные поля.

## UI

Карточка `Test IT` в «Интеграции» (страница настроек QA и карточка
конфигурации плагина — один и тот же бандл):

- статус, адрес инсталляции, «последняя успешная проверка», «токен настроен»;
- форма: выбор инсталляции из списка хоста (селект, если их больше одной; строка
  «Инсталляция: …», если одна) + write-only поле `API-токен Test IT`;
- список возможностей с галочками (политика `allow`/`deny`) и пометкой
  «Выключено оператором стенда» для того, что выключил оператор;
- «Проверить», «Заменить токен», «Отключить» с подтверждением;
- фрагмент токена не показывается никогда; при пустом списке инсталляций формы
  нет, есть текст «Оператор не настроил ни одной инсталляции Test IT».

## Многосчётность и изоляция

- Подключение — ровно одно на пользователя и провайдера; аккаунт резолвится из
  сессии, не из аргументов.
- Секреты шифруются per-record; в файле БД их нет (общий тест
  `broker-isolation.test.ts`), в `summary` не отдаётся `secretRef`.
- Отключение удаляет credential и делает последующие вызовы
  `IntegrationNotConnected`.
- Тулы недоступны сессии без principal (`PrincipalNotResolved`), в том числе
  делегированной: наследования principal дочерними сессиями нет.

## Тестирование

| Файл | Что покрывает |
|---|---|
| `tests/testit.test.ts` | адресная политика и канонизация, форма подключения, проба подключения, построение запросов и путей, конверты списков, проекции, политика вложений, таблица ошибок, повторы, таймаут/TLS, отказ операциям вне каталога |
| `tests/testit-catalog.test.ts` | каталог ↔ обработчики ↔ проекции, только GET, запрещённые пути и имена операций, capability ↔ тул, порядок регистрации, отсутствие селекторов в схемах |
| `tests/testit-page.test.tsx` | карточка: write-only токен, выбор инсталляции, галочки возможностей, отказ по политике, подтверждение отключения, «нечего подключать» |
| `tests/tools-security.test.ts` | каждый тул падает `PrincipalNotResolved` без principal и маршрутизируется в операцию каталога |
| `scripts/verify-package.mjs` | то же на собранном пакете: имена тулов, только GET, `PrivateToken` в транспорте, отсутствие адресов и лейблов каталога в клиентском бандле |

**Чего нет**: контрактных тестов против живой инсталляции (Cloud и on-prem) —
без них утверждения о `SearchField`, содержимом `TestRunV2ApiResult` и
поведении deprecated-эндпоинтов остаются выводами из спецификации, а не
измерениями.

## Открытые вопросы

Требуют живой инсталляции перед тем, как считать MVP проверенным:

1. Что реально возвращает `GET /projects/{id}/testRuns` в поле `testResults` —
   пустое или полное? Провайдер это поле выбрасывает, но если инсталляция
   отдаёт его целиком, ответ может упираться в `maxResponseBytes`.
2. Deprecated-эндпоинты (`/projects`, `/projects/{id}/workItems`, `/autoTests`)
   на актуальной версии: отвечают ли они и не отдают ли урезанную модель без
   нужных полей.
3. Регистр query-параметров (`Skip` против `skip`) на конкретной инсталляции.
4. Есть ли у `WorkItemShortModel` теги (`tagNames`) в тех версиях, что
   используются, — от этого зависит фильтр по тегу.
5. Нужна ли в MVP статистика прогона: если POST-статистика критична, это
   отдельное решение о расширении read-only правила пакета.
6. Какие поля тест-кейса важны QA-пользователям в этой организации (кастомные
   атрибуты приходят картой `attributes` как есть).
7. Нужны ли автотесты в MVP или достаточно результатов по тест-кейсу.
8. Приемлемый максимальный размер вложения (сейчас 10 MiB).

## Что дальше (Phase 2)

- Комментарии, правка тест-кейсов, создание прогона, управление его жизненным
  циклом и загрузка вложений — только после confirmation-фреймворка
  (`prepare → confirm → execute`), с политикой `confirm` по умолчанию и
  отказом на `archive`/`delete`/`purge` и администрирование.
- При появлении кэша — ключи со скоупом аккаунта (см. выше).
- При появлении контрактных тестов — прогон против Cloud и против on-prem
  версии заказчика.

## Official references

- Test IT API guide: <https://docs.testit.software/user-guide/work-with-api.html>
- Official JS API client (OpenAPI-спека, doc-файлы моделей):
  <https://github.com/testit-tms/api-client-js>
- Official Python API client: <https://github.com/testit-tms/api-client-python>
- Официальная организация Test IT: <https://github.com/testit-tms>
