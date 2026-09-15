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
```

## Что должен реализовать новый провайдер (gitlab, teamcity, …)

1. `providers/<id>/catalog.ts` — список возможностей и операций. Это
   permission surface: всё, что не описано здесь, недостижимо для модели.
   У каждой возможности — `flag` (выключатель оператора), `label` и `hint`
   (их показывает карточка настроек), а у операции — `capability` и метод
   внешнего API. Всё, что пишет (`*.add`, `*.delete`, произвольный REST),
   в каталог не попадает: сначала для этого нужен confirmation-фреймворк.
2. `providers/<id>/config.ts` — схема среза `providers.<id>` в YAML и дефолты.
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
5. Композиция — три строки: срез в `src/config.ts`, `providers.register(...)`
   в `src/index.ts`, `create<Id>Tools(...)` в `src/tools.ts`.

## Правила, которые проверяет гейт пакета

- В общих модулях хоста (`broker.ts`, `repository.ts`, `secrets/**`,
  `tool-kit.ts`, `providers/contract.ts`, `providers/registry.ts`, `types.ts`)
  не должно быть упоминаний конкретной интеграции: `pnpm verify:package`
  падает на `/bitrix/iu` вне `providers/bitrix24/`.
- Каждая операция каталога обязана иметь обработчик, и наоборот.
- Методы внешнего API в каталоге — только читающие.
- Число тулов = числу операций, и каждый тул назван в `INTEGRATION_TOOL_NAMES`.
