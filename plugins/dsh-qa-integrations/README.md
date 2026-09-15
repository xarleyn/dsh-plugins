# dsh-qa-integrations

Персональные интеграции для `@yadsh/dsh-qa-surface`. Плагин подключает Bitrix24 через URL входящего вебхука и даёт агенту набор read-only инструментов, ограниченный и правами вебхука, и персональной политикой пользователя.

Плагин добавляет в пользовательские настройки QA отдельный раздел **«Интеграции»**. Токен вводится один раз, шифруется на Host и никогда не возвращается браузеру. Выбор пользователя, integration id, secret id или токена отсутствует в model-visible схемах: principal берётся из DSH-сессии, а Bitrix user id — из сохранённой записи интеграции.

## Инструменты

CRM:

| Tool | Что делает |
| --- | --- |
| `bitrix_search_crm` | Поиск лидов, сделок, контактов, компаний, счетов и смарт-процессов по названию и ответственному |
| `bitrix_get_crm_item` | Полная карточка элемента CRM, включая пользовательские поля и коммуникации |
| `bitrix_get_crm_fields` | Схема полей типа сущности, включая `UF_CRM_*` портала |
| `bitrix_get_crm_funnels` | Воронки (категории) типа сущности |
| `bitrix_get_crm_statuses` | Расшифровка стадий и справочников (`STATUS`, `DEAL_STAGE`, `DEAL_STAGE_<id>`, `SOURCE`, …) |
| `bitrix_get_crm_activities` | Дела CRM: звонки, встречи, письма, задачи; просрочки и незавершённые |
| `bitrix_get_crm_activity` | Одно дело целиком, включая описание |
| `bitrix_get_crm_timeline` | Комментарии таймлайна лида, сделки, контакта, компании |
| `bitrix_get_crm_stage_history` | История движения по стадиям: сколько висело, куда возвращали |
| `bitrix_get_crm_product_rows` | Товарные позиции: что продаём, количество, цена, скидки |
| `bitrix_find_crm_duplicates` | Поиск дублей клиента по телефону или e-mail |
| `bitrix_get_crm_requisites` | Реквизиты контакта или компании: ИНН, КПП, адрес, банк |
| `bitrix_get_call_transcript` | Готовая AI-расшифровка звонка по делу CRM |

Сотрудники и структура:

| Tool | Что делает |
| --- | --- |
| `bitrix_get_current_user` | Чей вебхук подключён |
| `bitrix_search_users` | Поиск сотрудников по имени, e-mail, подразделению |
| `bitrix_get_departments` | Подразделения, родительский отдел, руководитель |
| `bitrix_get_user_fields` | Какие поля сотрудника доступны с этим вебхуком |

Чаты и открытые линии:

| Tool | Что делает |
| --- | --- |
| `bitrix_search_chats` | Поиск чатов по названию и участникам |
| `bitrix_get_chat_messages` | Последние сообщения чата |
| `bitrix_search_chat_messages` | Поиск по тексту и датам внутри одного чата |
| `bitrix_get_recent_chats` | Последние диалоги пользователя, счётчики непрочитанного |
| `bitrix_search_chat_users` | Поиск сотрудника как контакта чата: статус, телефоны |
| `bitrix_find_chat` | Чат, привязанный к объекту: обсуждение сделки, чат задачи, событие календаря, чат группы |
| `bitrix_get_chat_participants` | Кто участвует в чате |
| `bitrix_get_chat_user_data` | Профили участников: имя, должность, телефоны, присутствие |
| `bitrix_get_openline_dialog` | Диалог открытой линии: участники, связь с CRM |
| `bitrix_get_openline_history` | История переписки с клиентом в открытой линии |

Задачи, календарь, Диск:

| Tool | Что делает |
| --- | --- |
| `bitrix_search_tasks` | Задачи по названию, ответственному, группе, дедлайну |
| `bitrix_get_task` | Карточка задачи целиком, включая `ufCrmTask` |
| `bitrix_get_task_history` | История изменений задачи: что, когда и кем |
| `bitrix_get_task_results` | Результаты работы по задаче |
| `bitrix_get_task_elapsed_time` | Затраченное время: кто сколько залогировал |
| `bitrix_get_calendar_events` | События календаря сотрудника, группы или компании |
| `bitrix_get_calendar_accessibility` | Занятость сотрудников, чтобы предложить время встречи |
| `bitrix_search_files` | Поиск по Диску, включая текст внутри документов |
| `bitrix_get_file` | Метаданные и ссылка на файл Диска |
| `bitrix_get_drives` | Доступные диски и их id |
| `bitrix_get_storage_items` | Содержимое корня диска |
| `bitrix_get_folder_items` | Содержимое папки Диска |

Списочные инструменты отвечают единым конвертом `{ items, pagination }`: у модели одна форма ответа вместо шести разных у REST, а курсор следующей страницы не теряется. Методы, возвращающие словари по id (история открытой линии, занятость), спроецированы в упорядоченные массивы.


## Возможности и скопы

Одна возможность = один scope Bitrix24. Возможность появляется у пользователя только если её включил оператор (`bitrix24.*Read`) **и** подключённый вебхук реально получил соответствующий scope — плагин спрашивает это у портала методом `scope` при подключении и при нажатии «Проверить».

| Возможность | Scope вебхука | Что открывает |
| --- | --- | --- |
| `crm.read` | `crm` | CRM, дела, таймлайн, товарные строки, дубли |
| `chat.read` | `im` | Чаты, сообщения, поиск по переписке |
| `openlines.read` | `imopenlines` | Диалоги открытых линий и их история |
| `user.read` | `user_brief` / `user_basic` / `user` | Свой профиль и поиск сотрудников |
| `department.read` | `department` | Структура компании |
| `tasks.read` | `task` | Задачи |
| `calendar.read` | `calendar` | Календарь и занятость |
| `disk.read` | `disk` | Файлы Диска |

Выданные в Bitrix24 права не отменяются: портал всё равно применяет права того пользователя, чей вебхук используется. Возможность, обнаруженная после выдачи нового scope, появляется в карточке выключенной — пользователь включает её сам. Запись (`*.add`, `*.update`, `*.delete`), бизнес-процессы, управление пользователями и generic REST/MCP в surface отсутствуют.

Оператор стенда дополнительно решает, какие из инструментов видит модель: имена нужно добавить в tool allow-list пресета QA. Инструменты не принимают ни пользователя, ни credential, поэтому допуск к ним — решение оператора, а не модели.

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
        openlinesRead: true
        userRead: true
        departmentRead: true
        tasksRead: true
        calendarRead: true
        diskRead: true
```

`dataPath` по умолчанию — `$DSH_HOME/qa-integrations.json`. На Unix новый файл создаётся с mode `0600`. Разрешён только HTTPS URL вида `https://company.bitrix24.ru/rest/<user>/<secret>` без query, fragment, custom port или credentials в authority. Список доменных суффиксов задаётся оператором, а не пользователем.

## Пользовательский сценарий

1. В Bitrix24 создайте входящий вебхук и отметьте только нужные read scopes: `crm`, `im`, `imopenlines`, `user_brief` (или `user_basic`), `department`, `task`, `calendar`, `disk`. Урезанный набор вебхука — это и есть верхняя граница того, что увидит агент.
2. Откройте QA → Настройки → Интеграции.
3. Вставьте полный URL вебхука и нажмите «Сохранить и проверить». Плагин проверит профиль и прочитает выданные scopes.
4. После сохранения поле исчезнет: существующий токен нельзя показать или скопировать.
5. Отметьте, что именно разрешено агенту. Возможности, которых нет у вебхука, показаны как «Нет разрешения Bitrix24» и выключены.
6. Выдали в Bitrix24 новый scope — нажмите «Проверить», новая возможность появится в списке.

Отключение атомарно удаляет локальный encrypted secret; дальнейшие tool calls получают `IntegrationNotConnected`. Запись и generic REST/MCP вызовы отсутствуют. OAuth и confirmation-based writes намеренно остаются следующими фазами спецификации.

## Проверка пакета

```bash
pnpm --filter @yadsh/dsh-qa-integrations check
```

Unit/integration набор проверяет AEAD, неверный ключ, rewrap, SSRF-ограничение webhook URL, redaction, отсутствие model-visible identity/secret selectors, отказ unowned/subagent-сессии, соответствие каждого tool операции каталога, read-only характер каталога, сужение возможностей по scopes вебхука и параллельную изоляцию Alice/Bob.
