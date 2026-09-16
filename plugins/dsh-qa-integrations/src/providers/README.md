# Providers

Один каталог — одна интеграция. Всё, что знает про конкретный внешний сервис,
живёт в `providers/<id>/`; общий слой знает только про контракт.

```text
src/
  broker.ts            граница доверия: principal → запись интеграции → расшифровка
  tool-kit.ts          общая обвязка тулов: сессия → principal → broker.call
  tools.ts             композиция тулов всех включённых провайдеров
  config.ts            композиция конфига: общие ручки + срез на провайдера
  repository.ts        персистентность (owner + provider)
  secrets/             шифрование и master key
  types.ts             общие DTO; capability — свободная строка
  providers/
    contract.ts        IntegrationProvider
    registry.ts        реестр провайдеров
    bitrix24/
      index.ts         Bitrix24Provider: validate / execute / parseCredential
      catalog.ts       возможности (capability ↔ scope) и операции (operation ↔ метод)
      operations.ts    построение параметров запроса и проекции ответов
      transport.ts     HTTP-граница: разбор credential, таймаут, лимит размера
      config.ts        срез конфига и дефолты включённости
      tools.ts         model-visible тулы провайдера
    confluence/
      index.ts         ConfluenceProvider: validate / execute / parseCredential
      catalog.ts       возможности и операции (operation ↔ GET-путь), без единой записи
      operations.ts    валидация аргументов, выбор коллекции, курсоры, проекции ответов
      cql.ts           сборка CQL из типизированных фильтров и экранирование литералов
      adf.ts           Atlassian Document Format → markdown-подобный текст, плейсхолдеры макросов
      transport.ts     HTTP-граница: сайт из конфига, Basic-пара, повторы, лимит размера
      config.ts        список сайтов (SSRF-граница), политика пространств, бюджеты ответов
      tools.ts         model-visible тулы провайдера
    gitlab/
      index.ts         GitlabProvider: validate / execute / parseCredential
      catalog.ts       возможности (capability ↔ scope) и операции (operation ↔ POST-путь)
      operations.ts    путь+query запроса, валидация refs и путей, проекции ответов
      transport.ts     HTTP-граница: инстанс из конфига, PRIVATE-TOKEN, повторы, лимит размера
      config.ts        список инстансов (SSRF-граница) и операции
      tools.ts         model-visible тулы провайдера
    teamcity/
      index.ts         TeamcityProvider: validate / execute / parseCredential
      catalog.ts       возможности и операции (operation ↔ GET-путь), без единой записи
      operations.ts    locator-запросы, валидация аргументов, нормализация ответов
      locators.ts      сборка locator-строки и её кодирование
      logs.ts          чистка лога и выбор окна (head/tail/search)
      artifacts.ts     политика путей и типов артефактов, бюджеты чтения
      network.ts       политика адресов: allowlist/trusted-private, CIDR, порты
      transport.ts     HTTP-граница: Bearer-токен, повторы, лимит размера, коды ошибок
      config.ts        срез конфига вместе с политикой адресов
      tools.ts         model-visible тулы провайдера
    testit/
      index.ts         TestitProvider: validate / execute / parseCredential
      catalog.ts       возможности и операции (operation ↔ GET-путь), без единой записи
      operations.ts    запросы, лимиты, проекции ответов, конверты страниц
      attachments.ts   политика видов вложений и бюджет чтения
      transport.ts     HTTP-граница: PrivateToken, страницы (Pagination-*), лимит размера
      config.ts        список инсталляций (SSRF-граница), флаги, бюджеты
      tools.ts         model-visible тулы провайдера
    jira/
      index.ts         JiraProvider: validate / execute / parseCredential
      catalog.ts       возможности и операции (operation ↔ GET-путь) + allow-list читающих путей
      operations.ts    построение запросов, проекции ответов, нормализованная задача
      jql.ts           типизированные фильтры → JQL с экранированием значений
      adf.ts           Atlassian Document Format → ограниченный текст
      transport.ts     HTTP-граница: сайты из конфига, Basic email:token, повторы, лимит размера
      config.ts        список сайтов (SSRF-граница) и операции
      tools.ts         model-visible тулы провайдера
```

## Что должен реализовать новый провайдер (bitrix24, confluence, gitlab, jira, teamcity, testit, …)

1. `providers/<id>/catalog.ts` — список возможностей и операций. Это
   permission surface: всё, что не описано здесь, недостижимо для модели.
   У каждой возможности — `flag` (выключатель оператора), `label` и `hint`
   (их показывает карточка настроек), а у операции — `capability` и метод
   внешнего API. Всё, что пишет (`*.add`, `*.delete`, произвольный REST),
   в каталог не попадает: сначала для этого нужен confirmation-фреймворк.
2. `providers/<id>/config.ts` — схема среза `providers.<id>` в YAML и дефолты.
   Если провайдер ходит не на один фиксированный хост, а на инстансы, список
   инстансов объявляет оператор: адрес никогда не приходит из тула. GitLab
   канонизирует `baseUrl` при загрузке конфига и падает на ошибке оператора, а
   не выбрасывает инстанс молча.
3. `providers/<id>/index.ts` — класс с `IntegrationProvider`:
   - `parseCredential(raw)` — валидация и нормализация того, что ввёл оператор,
     без возврата секрета наружу;
   - `validate(context)` — проверка подключения; возвращает tenant, внешнего
     пользователя и **фактические** возможности: если внешний сервис умеет
     сообщать выданные права, сузьте ими список, как это делает Bitrix24 через
     метод `scope`;
   - `execute(context, operation, input)` — единственный путь к внешнему API;
   - `operationCapability(operation)` — маппинг операции в возможность;
   - `capabilityInfo` — label/hint из каталога.
4. `providers/<id>/tools.ts` — тулы через `createToolKit({ broker, principalForSession, provider })`.
   Имя тула = префикс провайдера (`gitlab_…`), описание — про read-only.
   Ни один тул не принимает пользователя, credential или integration id.
   Если подключение выбирает инстанс (GitLab), выбор живёт в форме
   подключения: `parseCredential(raw, options)` получает `instanceId` от
   операторского RPC, а не от модели, и запоминает его в credential.
   Если у провайдера один адрес на весь стенд (TeamCity), он приходит из
   конфига оператора (`<id>.serverUrl`), а не из формы: пользователь вводит
   только секрет, credential его не хранит, и адрес заново проверяется по
   политике адресов **на каждом вызове**, потому что политику можно ужесточить
   уже после подключения.
   Если провайдер требует не только секрет, но и не-секретную идентичность
   (Jira: `email` + API-токен в HTTP Basic), идентичность едет в том же
   `options`, а хранится в одном зашифрованном credential вместе с токеном.
   Если внешний API принимает язык запросов (Jira: JQL) — модель его не
   получает: тулы несут типизированные фильтры, а строка запроса собирается и
   экранируется внутри провайдера, отдельным модулем (`jql.ts`), который
   гейт проверяет вместе с allow-list читающих путей.
5. Композиция — три строки: срез в `src/config.ts`, `providers.register(...)`
   в `src/index.ts`, `create<Id>Tools(...)` в `src/tools.ts`.

## Правила, которые проверяет гейт пакета

- В общих модулях хоста (`broker.ts`, `repository.ts`, `secrets/**`,
  `tool-kit.ts`, `providers/contract.ts`, `providers/registry.ts`, `types.ts`)
  не должно быть упоминаний конкретной интеграции: `pnpm verify:package`
  падает на `/bitrix|confluence|gitlab|jira|teamcity|testit/iu` вне каталога
  самого провайдера.
- Каждая операция каталога обязана иметь обработчик, и наоборот.
- Методы внешнего API в каталоге — только читающие.
- Число тулов = числу операций, и каждый тул назван в `INTEGRATION_TOOL_NAMES`.
- В каталоге GitLab пути сверяются с allow-list читающих эндпоинтов, а
  `transport.ts` обязан слать `GET`, `redirect: "error"` и токен только в
  заголовке `PRIVATE-TOKEN`.
- В каталоге TeamCity у каждой операции `method: "GET"`, пути не заходят в
  `/parameters`, тэги, комментарии, mute-ы и администрирование, а `transport.ts`
  обязан слать `GET`, `redirect: "error"` и `Authorization: Bearer`.
- В каталоге Jira у каждой операции `method: "GET"`, а её путь обязан быть
  объявлен в `JIRA_READ_PATHS` — allow-list читающих эндпоинтов именно этого
  провайдера. Легаси-эндпоинт `/rest/api/3/search` (Atlassian его удалил) и
  любой `jql`-аргумент в схеме тула — падение гейта: запросы собирает
  `jql.ts`, а не модель. `transport.ts` обязан слать `GET`, `redirect: "error"`
  и `Authorization: Basic …` из `email:token`.
- В каталоге Confluence у каждой операции `method: "GET"`, пути лежат под
  `/wiki/api/v2` или `/wiki/rest/api` и не заходят в снятый v1 content API,
  администрирование, свойства, операции, лайки, наблюдателей и ограничения; у
  каждой списочной операции объявлено, как она листается (`cursor: "offset"` у
  поиска, `cursor: "upstream"` у v2), а `transport.ts` обязан слать `GET`,
  `redirect: "error"` и пару `Authorization: Basic` — токен не попадает ни в
  URL, ни в тело. Политику пространств (`allowedSpaces`) провайдер применяет и
  к поиску, и к прямому чтению: отказ обязан быть `OperationDeniedByPolicy`.
- В каталоге Test IT у каждой операции `method: "GET"`, путь лежит под `/api/v2` и не
  заходит ни в один search-эндпоинт (у Test IT они все POST), ни в like/move/purge/
  restore/actual/transform, ни в администрирование (webhooks, parameters, users,
  backgroundJobs), а `transport.ts` обязан слать `GET`, `redirect: "error"` и
  `Authorization: PrivateToken …` — токен не попадает ни в URL, ни в тело. Адрес
  инсталляции объявляет оператор, поэтому `index.ts` резолвит её из конфига на каждом
  вызове (`credentialInstance`), а вложение читается только после `…/metadata`: вид и
  размер файла берутся у Test IT, а не из аргументов тула.
