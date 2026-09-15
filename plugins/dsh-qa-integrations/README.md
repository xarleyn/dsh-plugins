# dsh-qa-integrations

Персональные интеграции для `@yadsh/dsh-qa-surface`. Плагин подключает Bitrix24 через URL входящего вебхука и GitLab через personal access token, после чего даёт агенту набор read-only инструментов, ограниченный и правами подключения, и персональной политикой пользователя.

Плагин добавляет в пользовательские настройки QA отдельный раздел **«Интеграции»**. Токен вводится один раз, шифруется на Host и никогда не возвращается браузеру. Выбор пользователя, integration id, secret id или токена отсутствует в model-visible схемах: principal берётся из DSH-сессии, а Bitrix user id — из сохранённой записи интеграции.

## Структура

Один каталог — одна интеграция. Всё, что знает про Bitrix24, лежит в `src/providers/bitrix24/`, всё, что знает про GitLab, — в `src/providers/gitlab/`: каталог возможностей и операций, построение запросов, HTTP-граница, срез конфига и тулы. Общий слой — брокер, репозиторий, секреты, обвязка тулов — не знает ни одной интеграции по имени: capability это свободная строка, а `providers/contract.ts` описывает, что должен уметь провайдер. Порядок добавления следующей интеграции (TeamCity, …) и правила, которые проверяет гейт пакета, — в [src/providers/README.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-integrations/src/providers/README.md).

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

## Инструменты GitLab

| Tool | Что делает |
| --- | --- |
| `gitlab_connection_get` | К какому инстансу и каким пользователем подключён аккаунт |
| `gitlab_projects_list` | Поиск проектов: путь, ветка по умолчанию, видимость |
| `gitlab_project_get` | Карточка проекта: описание, namespace, даты |
| `gitlab_repository_tree` | Содержимое каталогов на выбранном ref, постранично |
| `gitlab_repository_file_get` | Текст файла с метаданными; бинарное и слишком большое — только метаданные |
| `gitlab_commits_list` | Коммиты проекта, ветки или одного файла |
| `gitlab_commit_get` | Один коммит: сообщение, автор, родители, объём изменений |
| `gitlab_compare` | Сравнение двух refs: коммиты и изменённые файлы |
| `gitlab_search` | Поиск по проектам, задачам, MR, коммитам, коду и комментариям |
| `gitlab_issues_list` | Задачи по проекту, состоянию, автору, исполнителю, меткам, датам |
| `gitlab_issue_get` | Карточка задачи: описание, веха, срок |
| `gitlab_issue_notes_list` | Комментарии задачи, системные помечены |
| `gitlab_merge_requests_list` | Merge requests по проекту, веткам, автору, ревьюеру, черновику |
| `gitlab_merge_request_get` | Карточка MR: описание, ветки, статус слияния, конфликты |
| `gitlab_merge_request_changes_get` | Изменённые файлы MR с диффами |
| `gitlab_merge_request_discussions_list` | Обсуждения ревью и их разрешение |
| `gitlab_merge_request_approvals_get` | Сколько одобрений нужно, сколько есть, кто одобрил |
| `gitlab_merge_request_pipelines_list` | Пайплайны, привязанные к MR |
| `gitlab_pipelines_list` | Пайплайны проекта по ветке, статусу, источнику, автору |
| `gitlab_pipeline_get` | Один пайплайн: статус, длительности, покрытие |
| `gitlab_pipeline_jobs_list` | Джобы пайплайна: стадия, статус, длительность |
| `gitlab_job_get` | Одна джоба: причина падения, теги, список артефактов |
| `gitlab_job_log_get` | Лог джобы: ограничен по размеру и очищен от токенов |

Списочные инструменты GitLab отвечают тем же конвертом `{ items, pagination }`; `pagination.nextPage` — это номер следующей страницы, а не подписанный курсор: состояние между вызовами не хранится, principal и права перепроверяются на каждом вызове.

Диффы (`gitlab_compare`, `gitlab_merge_request_changes_get`) отдают список файлов целиком, а текст диффов — в пределах общего бюджета символов; при обрезке ответ помечается `diffTruncated`. Логи CI обрезаются по лимиту стенда и дополнительно проходят через редакцию секретов: встроенная маскировка GitLab — фильтр, а не гарантия.


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

## Возможности и скопы GitLab

Подключение — personal access token. Возможность появляется у пользователя только если её включил оператор (`gitlab.*Read`) **и** токен при подключении реально предъявил соответствующий scope: плагин спрашивает scopes у самого токена (`GET /api/v4/personal_access_tokens/self`) при сохранении и при нажатии «Проверить». Токен, который не может прочитать себя (старый GitLab, group/project access token), только снижает точность — срез остаётся на деплой-флагах оператора.

| Возможность | Scope токена | Что открывает |
| --- | --- | --- |
| `identity.read` | `read_user` / `read_api` / `api` | Свой профиль: логин, имя, инстанс |
| `projects.read` | `read_api` / `api` | Проекты, видимость, ветка по умолчанию |
| `repository.read` | `read_repository` / `read_api` / `api` | Дерево, файлы, коммиты, сравнение веток |
| `search.read` | `read_api` / `api` | Поиск по проектам, задачам, MR, коммитам, коду |
| `issues.read` | `read_api` / `api` | Задачи и комментарии к ним |
| `merge_requests.read` | `read_api` / `api` | MR, диффы, обсуждения, одобрения, пайплайны MR |
| `ci.read` | `read_api` / `api` | Пайплайны, джобы, логи джоб |

У GitLab нет отдельного read-scope на каждую область, поэтому `read_api` покрывает почти всё, а `read_repository` и `read_user` дают узкие наборы. Права токена не отменяются: GitLab всё равно применяет права своего пользователя. Возможность, появившаяся после выдачи нового scope, приходит в карточку выключенной. Запись (`POST`/`PUT`/`DELETE`), GraphQL, произвольный REST, admin-API, управление токенами, участниками и CI-переменными в surface отсутствуют; merge и запись в репозиторий — тоже.

Оператор стенда дополнительно решает, какие из инструментов видит модель: имена нужно добавить в tool allow-list пресета QA. Инструменты не принимают ни пользователя, ни credential, поэтому допуск к ним — решение оператора, а не модели.

## Как подключается GitLab

Инстансы GitLab задаёт только оператор: пользователь выбирает из списка и вставляет токен, произвольный хост ввести нельзя. Если инстанс один, выбор не показывается; если инстансов нет, карточка честно сообщает, что подключать нечего.

Правила адреса инстанса (то, что защищает брокер от SSRF): только `http`/`https`, HTTPS обязателен вне явного `allowInsecureHttp` для стенда; без credentials, query и fragment в URL; путь допустим (GitLab, смонтированный в подкаталог), хвостовой слэш срезается; id инстанса — стабильный ключ, который и хранит секрет. Адрес не сохраняется в credential: он перечитывается из конфига на каждом вызове, поэтому удаление или переезд инстанса немедленно закрывает доступ к сохранённому токену (`CredentialRevoked`), и подмены на другой инстанс не происходит. Redirect не отслеживается (`redirect: "error"`), токен уходит только в заголовке `PRIVATE-TOKEN`, в URL и теле его нет.

## Конфигурация GitLab

```yaml
gitlab:
  enabled: true
  allowInsecureHttp: false        # только для dev-стенда
  instances:
    - id: gitlab-com
      label: GitLab.com
      baseUrl: https://gitlab.com
    - id: corp
      label: Corporate GitLab
      baseUrl: https://gitlab.example.internal
  identityRead: true
  projectsRead: true
  repositoryRead: true
  searchRead: true
  issuesRead: true
  mergeRequestsRead: true
  ciRead: true
  maxFileBytes: 131072            # сколько тела файла отдаём модели
  maxJobLogBytes: 262144          # сколько лога джобы отдаём модели
  maxSearchResults: 50            # потолок per page у поиска
  retries: 2                      # повторы для 429/5xx и сетевых сбоев
```

OAuth-приложение для GitLab не нужно: подключение идёт персональным токеном. Токен создаётся в GitLab (`User settings → Access tokens`) с read-scope, вводится один раз в карточке, шифруется тем же конвертным хранилищем, что и вебхук Bitrix24, и после сохранения не показывается и не копируется.

## Чего в GitLab-провайдере ещё нет

Спецификация `docs/SPEC-providers-gitlab.md` описывает целевую архитектуру; в этой версии сознательно реализована только read-only фаза, как и у Bitrix24:

- **OAuth Authorization Code + PKCE** (§8.1) — вместо него PAT (§8.2). Для OAuth нужны callback-маршрут на хосте, одноразовый state и refresh-цикл; это отдельная фаза.
- **Пользовательская граница ресурсов** (§12): сейчас доступ ограничен правами токена и персональной политикой возможностей, но не выбранным набором проектов/групп.
- **Pending actions и подтверждения** (§15) — вместе с ними отложены все записи: комментарии, создание задач и MR, запуск и отмена пайплайнов.
- **Кэш** (§21) отсутствует полностью, поэтому и межпользовательской утечки через кэш быть не может; пагинация stateless, подписанных continuation-токенов нет.
- **Webhooks** (§23) и **официальный GitLab MCP** (§24) — не подключены; REST API v4 остаётся единственным бэкендом.

## Граница доверия

Интеграционный principal получается только из QA Surface:

1. браузер аутентифицируется штатным account token QA Surface;
2. `secureSession` проверяет владельца DSH-сессии;
3. интеграционный principal закрепляется только если текущий пользователь и владелец совпадают;
4. администраторский просмотр чужого чата, неаттестованная сессия и subagent не получают principal;
5. broker находит подключение по паре `ownerUserId + provider` и только внутри себя расшифровывает credential;
6. адрес внешнего сервиса приходит только из конфига оператора: у GitLab это выбранный инстанс, у Bitrix24 — проверенный по доменному allowlist URL вебхука.

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
      gitlab:
        enabled: true
        instances:
          - id: gitlab-com
            label: GitLab.com
            baseUrl: https://gitlab.com
```

`dataPath` по умолчанию — `$DSH_HOME/qa-integrations.json`. На Unix новый файл создаётся с mode `0600`. Разрешён только HTTPS URL вида `https://company.bitrix24.ru/rest/<user>/<secret>` без query, fragment, custom port или credentials в authority. Список доменных суффиксов задаётся оператором, а не пользователем.

## Пользовательский сценарий

1. В Bitrix24 создайте входящий вебхук и отметьте только нужные read scopes: `crm`, `im`, `imopenlines`, `user_brief` (или `user_basic`), `department`, `task`, `calendar`, `disk`. Урезанный набор вебхука — это и есть верхняя граница того, что увидит агент.
2. Откройте QA → Настройки → Интеграции.
3. Вставьте полный URL вебхука и нажмите «Сохранить и проверить». Плагин проверит профиль и прочитает выданные scopes.
4. После сохранения поле исчезнет: существующий токен нельзя показать или скопировать.
5. Отметьте, что именно разрешено агенту. Возможности, которых нет у вебхука, показаны как «Нет разрешения Bitrix24» и выключены.
6. Выдали в Bitrix24 новый scope — нажмите «Проверить», новая возможность появится в списке.

Для GitLab: создайте personal access token с read-scope, выберите инстанс (если их несколько), вставьте токен и нажмите «Сохранить и проверить». Плагин проверит профиль, прочитает scopes токена и покажет, что именно доступно агенту.

Отключение атомарно удаляет локальный encrypted secret; дальнейшие tool calls получают `IntegrationNotConnected`. Запись и generic REST/MCP вызовы отсутствуют. OAuth и confirmation-based writes намеренно остаются следующими фазами спецификации — и для Bitrix24, и для GitLab.

## Проверка пакета

```bash
pnpm --filter @yadsh/dsh-qa-integrations check
```

Unit/integration набор проверяет AEAD, неверный ключ, rewrap, SSRF-ограничение webhook URL и адресов инстансов, redaction (включая форму gitlab-токена), отсутствие model-visible identity/secret selectors, отказ unowned/subagent-сессии, соответствие каждого tool операции каталога, read-only характер обоих каталогов, сужение возможностей по scopes вебхука и токена, отображение ошибок GitLab в доменные коды, обрезку больших ответов и параллельную изоляцию Alice/Bob. Отдельный гейт следит за границей провайдеров: `verify:package` падает, если в общем слое появится имя конкретной интеграции, а тест `provider boundary` — если брокер начнёт зависеть от Bitrix24.
