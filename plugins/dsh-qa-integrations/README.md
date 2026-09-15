# dsh-qa-integrations

Персональные интеграции для `@yadsh/dsh-qa-surface`. MVP подключает Bitrix24 через URL входящего вебхука и предоставляет агенту только четыре read-only tool:

- `bitrix_search_crm`
- `bitrix_get_crm_item`
- `bitrix_search_chats`
- `bitrix_get_chat_messages`

Плагин добавляет в пользовательские настройки QA отдельный раздел **«Интеграции»**. Токен вводится один раз, шифруется на Host и никогда не возвращается браузеру. Выбор пользователя, integration id, secret id или токена отсутствует в model-visible схемах.

## Граница доверия

Интеграционный principal получается только из QA Surface:

1. браузер аутентифицируется штатным account token QA Surface;
2. `secureSession` проверяет владельца DSH-сессии;
3. интеграционный principal закрепляется только если текущий пользователь и владелец совпадают;
4. администраторский просмотр чужого чата, неаттестованная сессия и subagent не получают principal;
5. broker находит подключение по паре `ownerUserId + provider` и только внутри себя расшифровывает credential.

В логах и audit сохраняются только provider, operation, result и source session id. Тела CRM/чатов, HTTP-заголовки и секреты не журналируются. Постоянный cache данных провайдера отсутствует.

## Подготовка master key

Создайте отдельный 256-битный ключ вне БД и репозитория. Docker secret по умолчанию должен быть доступен Host как:

```text
/run/secrets/qa_integrations_master_key
```

Файл может содержать ровно 32 случайных байта, 64 hex-символа или base64 от 32 байт. Пример для Linux:

```bash
umask 077
openssl rand -base64 32 > qa_integrations_master_key
```

Пример для PowerShell:

```powershell
$keyBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
[Convert]::ToBase64String($keyBytes) | Set-Content -NoNewline qa_integrations_master_key
```

Не меняйте файл ключа поверх существующего deployment: старые записи перестанут расшифровываться. `KeyProvider` и `SecretStore.rewrap()` поддерживают контролируемую ротацию с одновременной доступностью старой и новой версии; операционный CLI ротации оставлен для hardening-фазы.

## Конфигурация

Плагин безопасно выключен в bundle patch, пока не смонтирован master key:

```yaml
- update:
    id: qa-integrations
    config:
      enabled: true
      dataPath: /var/lib/dsh/qa-integrations.json
      masterKeyPath: /run/secrets/qa_integrations_master_key
      masterKeyVersion: 1
      timeoutMs: 15000
      maxResponseBytes: 2000000
      allowedPortalSuffixes:
        - .bitrix24.ru
        - .bitrix24.com
        - .bitrix24.eu
      bitrix24:
        enabled: true
        crmRead: true
        chatRead: true
```

`dataPath` по умолчанию — `$DSH_HOME/qa-integrations.json`. На Unix новый файл создаётся с mode `0600`. Разрешён только HTTPS URL вида `https://company.bitrix24.ru/rest/<user>/<secret>` без query, fragment, custom port или credentials в authority. Список доменных суффиксов задаётся оператором, а не пользователем.

## Пользовательский сценарий

1. В Bitrix24 создайте входящий вебхук только с необходимыми read scopes (`crm`, `im`).
2. Откройте QA → Настройки → Интеграции.
3. Вставьте полный URL вебхука и нажмите «Сохранить и проверить».
4. После сохранения поле исчезнет: существующий токен нельзя показать или скопировать.
5. Отдельно разрешите/запретите агенту чтение CRM и чатов.

Отключение атомарно удаляет локальный encrypted secret; дальнейшие tool calls получают `IntegrationNotConnected`. Запись и generic REST/MCP вызовы в MVP отсутствуют. OAuth и confirmation-based writes намеренно остаются следующими фазами спецификации.

## Проверка пакета

```bash
pnpm --filter @yadsh/dsh-qa-integrations check
```

Unit/integration набор проверяет AEAD, неверный ключ, rewrap, SSRF-ограничение webhook URL, redaction, отсутствие model-visible identity/secret selectors, отказ unowned/subagent-сессии и параллельную изоляцию Alice/Bob.
