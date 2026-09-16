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
```

## Что должен реализовать новый провайдер (gitlab, teamcity, …)

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
   Если адрес вводит пользователь (TeamCity), он приходит тем же путём —
   `options.serverUrl` из формы подключения — и проверяется по политике
   адресов из конфига оператора при сохранении **и** на каждом вызове, потому
   что политику можно ужесточить уже после подключения.
5. Композиция — три строки: срез в `src/config.ts`, `providers.register(...)`
   в `src/index.ts`, `create<Id>Tools(...)` в `src/tools.ts`.

## Правила, которые проверяет гейт пакета

- В общих модулях хоста (`broker.ts`, `repository.ts`, `secrets/**`,
  `tool-kit.ts`, `providers/contract.ts`, `providers/registry.ts`, `types.ts`)
  не должно быть упоминаний конкретной интеграции: `pnpm verify:package`
  падает на `/bitrix|gitlab|teamcity/iu` вне каталога самого провайдера.
- Каждая операция каталога обязана иметь обработчик, и наоборот.
- Методы внешнего API в каталоге — только читающие.
- Число тулов = числу операций, и каждый тул назван в `INTEGRATION_TOOL_NAMES`.
- В каталоге GitLab пути сверяются с allow-list читающих эндпоинтов, а
  `transport.ts` обязан слать `GET`, `redirect: "error"` и токен только в
  заголовке `PRIVATE-TOKEN`.
- В каталоге TeamCity у каждой операции `method: "GET"`, пути не заходят в
  `/parameters`, тэги, комментарии, mute-ы и администрирование, а `transport.ts`
  обязан слать `GET`, `redirect: "error"` и `Authorization: Bearer`.
