# Настройка `dsh-web-fetch-authenticated` для Jira и Confluence

Этот сценарий даёт модели доступ на чтение к конкретным задачам Jira и
страницам Confluence через обычный `web_fetch(url)`. Секрет остаётся на стороне
DSH Host: модель передаёт только URL, а плагин выбирает правило, проверяет
адрес назначения и добавляет авторизацию.

Гайд подходит для:

- Jira и Confluence Server/Data Center с PAT или локальной учётной записью,
  для которой разрешён Basic auth;
- Jira и Confluence Cloud с API token;
- внутренних адресов в RFC1918/ULA-сетях;
- публичных корпоративных адресов с прямой API-авторизацией.

Плагин выполняет только HTTP GET. Он не ищет задачи и страницы, не создаёт и
не изменяет их. OAuth 2.0 flows, браузерные cookies и прохождение
интерактивного SSO не поддерживаются: credential должен приниматься
Jira/Confluence REST API без страницы входа.

## 1. Что подготовить

До настройки уточните у администратора:

1. Точные внешние имена, например `jira.corp.example` и
   `confluence.corp.example`. В правилах разрешены только точные hostnames, без
   `*.corp.example`.
2. Тип инсталляции Jira: Server/Data Center или Cloud.
3. Способ API-авторизации и учётную запись только с необходимыми правами
   чтения.
4. CIDR подсетей, в которые DNS резолвит корпоративные имена. Не разрешайте
   целиком `10.0.0.0/8`, если достаточно одной подсети.
5. Корневой сертификат корпоративного CA, если TLS-сертификат не доверен
   Node.js на машине с DSH Host.

Проверять DNS, маршруты, VPN и TLS нужно именно с машины или контейнера, где
запущен DSH Host, а не только из браузера оператора.

## 2. Установить плагин и выбрать provider

Для стандартного web-profile:

```bash
dsh plugin --profile web add @yadsh/dsh-web-fetch-authenticated
```

Для локального checkout репозитория:

```bash
pnpm --filter @yadsh/dsh-web-fetch-authenticated build
dsh plugin --profile web add ./plugins/dsh-web-fetch-authenticated
```

Установка регистрирует provider с id `authenticated`, но стандартный профиль
может продолжать использовать штатный provider `http`. Добавьте в пользовательский
patch профиля `$DSH_HOME/profiles/web/cordis.patch.yml` следующий override.
Не перезаписывайте файл целиком, если в нём уже есть другие настройки:

```yaml
- id: web
  config:
    fetchProvider: authenticated
```

Если используется другой profile, замените `web` в пути и в команде установки
на его имя. После изменения перезапустите DSH Host, если профиль не применил
patch или новый browser bundle автоматически.

Откройте **Settings → Plugins → Plugin Configuration → Authenticated Web
Fetch**. В секции **Provider** должно быть написано:

```text
ctx.web fetchProvider: pinned to "authenticated"
```

Если там указан `http`, правила настроены, но `web_fetch` их не использует.
Переменная `DSH_WEB_FETCH_PROVIDER` помогает только когда значение provider не
задано самой composition; для стандартного профиля надёжнее явный patch выше.

## 3. Выбрать тип авторизации

Используйте тот способ, который включён администраторами именно для REST API:

| Контур | Authentication в правиле | Открытые поля | Что хранится как secret |
| --- | --- | --- | --- |
| Jira/Confluence Cloud | `Basic auth` | Username = email Atlassian-аккаунта | API token |
| Server/Data Center с PAT | `Bearer token` | — | PAT |
| Server/Data Center с локальной учётной записью и разрешённым Basic auth | `Basic auth` | Username | Пароль |
| Корпоративный API gateway | `API key header` | Header name и, при необходимости, Value prefix | Значение ключа |

Новые Atlassian Data Center service accounts используют OAuth 2.0 client
credentials, который этот плагин пока не реализует. Для текущей версии
плагина нужен PAT либо отдельно разрешённый администратором Basic/custom-header
вариант. Сверьтесь с официальными инструкциями Atlassian для
[Jira Cloud Basic auth](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/),
[Confluence Cloud Basic auth](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/),
[Data Center PAT](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)
и [Data Center service accounts](https://confluence.atlassian.com/enterprise/service-accounts-overview-1627095923.html).

Для заголовка `Authorization` не используйте режим `API key header`: этот
заголовок намеренно запрещён. Выберите встроенный `Bearer token` или
`Basic auth`.

Credential reference — это не токен, а имя ссылки на него, например
`CORP_JIRA_PAT`. Имя должно соответствовать шаблону
`[A-Za-z_][A-Za-z0-9_]*`.

В редакторе правила:

1. Введите reference name.
2. Вставьте token/password в **Secret value**.
3. Нажмите **Save secret** и дождитесь статуса `configured`.
4. Сохраните само правило кнопкой **Save rule**.

Секрет записывается через credential store DSH и больше не возвращается в UI.
В YAML храните только reference name. Если credential приходит из read-only
источника, например окружения Host, UI покажет это и не позволит заменить его;
задайте переменную окружения с тем же именем вне YAML.

Для Jira и Confluence лучше использовать разные reference names и разные
токены. Один reference допустим, если обе системы действительно используют
один Cloud API token и одинаковую сервисную учётную запись.

## 4. Создать правило Jira

Нажмите **Add rule** и заполните:

- **Rule name:** `Corporate Jira`;
- **Hostnames:** только hostname, без `https://` и пути;
- **Ports:** оставьте пустым для стандартного 443;
- **Allowed path patterns:** UI принимает по одному glob на строку;
- **Authentication:** выбранный на предыдущем шаге способ;
- **Content adapter:** `Jira issue (REST → clean text)`;
- **Jira flavor:** `Server / Data Center` либо `Cloud`;
- **Test URL:** URL реальной задачи, доступной сервисной учётной записи.

Минимальный набор путей для Jira Server/Data Center, установленной в корне
origin:

```text
/browse/**
/issues/**
/rest/api/2/**
```

Для Jira Cloud замените последнюю строку на:

```text
/rest/api/3/**
```

Адаптер распознаёт ссылки вида `/browse/ABC-123` и `/issues/ABC-123`, получает
задачу через REST v2 (Server/DC) или v3 (Cloud) и возвращает компактный
Markdown. **Include comments** и **Include issue links** лучше включать только
при необходимости: они увеличивают ответ и открывают модели больше данных.

### Сетевая политика Jira

Для внутреннего hostname откройте **Network policy, redirects, and limits**:

- снимите **Public IPs**, если имя не должно резолвиться в публичные адреса;
- не включайте целиком **Private networks (RFC1918)** без необходимости;
- внесите согласованные подсети в **Allowed CIDRs**, например
  `10.24.16.0/20`;
- оставьте **Loopback**, **Link-local**, **Carrier-grade NAT** и
  **IPv6 unique-local** выключенными, если их явно не требует сеть;
- оставьте **Redirects: Same-origin only** и **Max redirects: 3**.

`Allowed CIDRs` разрешает адреса из указанной сети, даже если класс private по
умолчанию запрещён. `Denied CIDRs` имеет приоритет над разрешением. Плагин
проверяет все DNS-ответы: если хотя бы один адрес запрещён, запрос блокируется.

Пример полностью декларативного правила Jira Data Center:

```yaml
- id: web-fetch-authenticated
  config:
    enabled: true
    rules:
      - id: corp-jira
        name: Corporate Jira
        description: Read-only access to Jira issues
        enabled: true
        testUrl: https://jira.corp.example/browse/ABC-123
        match:
          schemes: [https]
          hosts: [jira.corp.example]
          allowPaths:
            - /browse/**
            - /issues/**
            - /rest/api/2/**
        auth:
          type: bearer
          credential: CORP_JIRA_PAT
        networkPolicy:
          allowPublic: false
          allowPrivate: false
          allowedCidrs: [10.24.16.0/20]
        redirects:
          mode: same-origin
          maxRedirects: 3
        adapter:
          type: jira
          jiraFlavor: server
          includeComments: false
          includeLinks: false
```

Значение `CORP_JIRA_PAT` должно быть заранее записано в credential store или
передано Host через одноимённый credential source. Сам PAT в этот файл не
помещайте.

## 5. Создать правило Confluence

Создайте отдельное правило, даже если права и учётная запись совпадают с Jira:

- **Rule name:** `Corporate Confluence`;
- **Hostnames:** точный hostname Confluence;
- **Content adapter:** `Confluence page (REST → clean text)`;
- **Test URL:** URL реальной доступной страницы.

Для Confluence Server/Data Center в корне origin используйте:

```text
/pages/**
/display/**
/rest/api/content
/rest/api/content/**
```

Для Confluence Cloud достаточно ограничить правило пространством `/wiki`:

```text
/wiki/**
```

Адаптер поддерживает страницы по numeric id (`.../pages/123456/...`) и
Server/DC display URL (`.../display/SPACE/Page+Title`). Он вызывает REST API с
`body.storage,space,version` и преобразует storage XHTML в Markdown.

Пример декларативного правила Confluence Data Center:

```yaml
- id: web-fetch-authenticated
  config:
    rules:
      - id: corp-confluence
        name: Corporate Confluence
        description: Read-only access to Confluence pages
        enabled: true
        testUrl: https://confluence.corp.example/display/OPS/Runbook
        match:
          schemes: [https]
          hosts: [confluence.corp.example]
          allowPaths:
            - /pages/**
            - /display/**
            - /rest/api/content
            - /rest/api/content/**
        auth:
          type: bearer
          credential: CORP_CONFLUENCE_PAT
        networkPolicy:
          allowPublic: false
          allowPrivate: false
          allowedCidrs: [10.24.32.0/20]
        redirects:
          mode: same-origin
          maxRedirects: 3
        adapter:
          type: confluence
```

В реальном profile оба правила должны находиться в одном массиве `rules`
одной записи `id: web-fetch-authenticated`. Два фрагмента выше показаны
раздельно только для читаемости: если просто вставить оба, более поздний
override массива заменит предыдущий.

## 6. Пример для Jira и Confluence Cloud на одном tenant

У Cloud-продуктов hostname часто общий. Разведите правила непересекающимися
путями; иначе запрос завершится с `AUTH_FETCH_AMBIGUOUS_MATCH`.

```yaml
- id: web
  config:
    fetchProvider: authenticated

- id: web-fetch-authenticated
  config:
    enabled: true
    rules:
      - id: cloud-jira
        name: Jira Cloud
        enabled: true
        testUrl: https://acme.atlassian.net/browse/ABC-123
        match:
          hosts: [acme.atlassian.net]
          allowPaths:
            - /browse/**
            - /issues/**
            - /rest/api/3/**
        auth:
          type: basic
          username: service-account@acme.example
          passwordCredential: ATLASSIAN_API_TOKEN
        redirects:
          mode: same-origin
          maxRedirects: 3
        adapter:
          type: jira
          jiraFlavor: cloud

      - id: cloud-confluence
        name: Confluence Cloud
        enabled: true
        testUrl: https://acme.atlassian.net/wiki/spaces/OPS/pages/123456/Runbook
        match:
          hosts: [acme.atlassian.net]
          allowPaths: [/wiki/**]
        auth:
          type: basic
          username: service-account@acme.example
          passwordCredential: ATLASSIAN_API_TOKEN
        redirects:
          mode: same-origin
          maxRedirects: 3
        adapter:
          type: confluence
```

Проверка пересечения в UI консервативна и может показать warning для двух
правил с одним hostname, даже когда их `allowPaths` не пересекаются. Это не
ошибка исполнения: **Diagnose** для Jira URL должен выбрать только
`cloud-jira`, а для `/wiki/...` — только `cloud-confluence`.

## 7. Проверить настройку

Проверяйте каждое правило в таком порядке:

1. В секции **Provider** убедитесь, что provider включён и pinned to
   `authenticated`.
2. Убедитесь, что credential показывает `configured`.
3. В секции **Diagnostics** вставьте URL задачи/страницы и нажмите
   **Diagnose**. Эта операция проверяет URL, выбор правила, DNS и сетевую
   политику, но не отправляет HTTP-запрос.
4. В строке правила нажмите **Test**, вставьте тот же URL и нажмите **Run
   test**. Ожидаемый результат: `ok`, HTTP 200, `Auth applied: yes`, правильный
   `Adapter` и читаемый Markdown в preview.
5. В обычной сессии попросите агента прочитать именно полный URL. Например:

   ```text
   Прочитай https://jira.corp.example/browse/ABC-123 и кратко перечисли
   статус, исполнителя и критерии приёмки.
   ```

Для проверки адаптера используйте реальную ссылку на issue/page, а не `/status`
или главную страницу. Нераспознанный URL намеренно обрабатывается как обычный
HTML и не доказывает, что REST-адаптер работает.

## 8. Типовые ошибки

| Симптом или код | Что проверить |
| --- | --- |
| Provider показывает `pinned to "http"` | Добавлен ли override `id: web` с `fetchProvider: authenticated`; применён ли нужный profile |
| `AUTH_FETCH_NO_MATCHING_RULE` | Точный hostname, HTTPS/HTTP, port и `allowPaths`; path начинается с `/` и чувствителен к структуре URL |
| `AUTH_FETCH_AMBIGUOUS_MATCH` | Один URL попал сразу под два enabled-правила; разделите host/path/port или отключите лишнее правило |
| `AUTH_FETCH_CREDENTIAL_MISSING` | Reference name валиден и совпадает с именем сохранённого credential; после ввода секрета нажата **Save secret** |
| `AUTH_FETCH_NETWORK_DENIED` или `AUTH_FETCH_DNS_POLICY_DENIED` | Все A/AAAA-адреса входят в разрешённые классы/CIDR; VPN и DNS доступны с Host |
| HTTP 401 | Неверный тип auth, username/token, истёкший PAT или REST API не принимает этот credential |
| HTTP 403 | Учётная запись аутентифицирована, но не видит проект, issue, space или page |
| `AUTH_FETCH_REDIRECT_DENIED` | REST-запрос уходит на SSO/login или другой origin; используйте прямой API credential, не расширяйте redirect allowlist без отдельной проверки |
| `AUTH_FETCH_ADAPTER_FAILED` | REST вернул HTML login page или невалидный JSON; выбран неверный Jira flavor, URL не поддержан либо продукт установлен под нестандартным context path |
| Ошибка TLS certificate | Добавьте корпоративный CA в trust store процесса Node.js, например через [`NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile), и перезапустите Host |
| Test возвращает HTML с формой входа | URL не распознан адаптером или credential не принимается API; проверьте форму URL и прямой REST-доступ |

## 9. Ограничения URL и корпоративной инфраструктуры

- Jira adapter строит REST URL от корня origin: `/rest/api/2/...` или
  `/rest/api/3/...`. Инсталляция по context path вроде
  `https://host.example/jira/...` может распознать issue URL, но её REST path
  автоматически не выводится. Для такого контура используйте root/reverse
  proxy, режим Raw HTTP/HTML или доработанный adapter.
- Confluence adapter знает root `/rest/api` и Cloud prefix `/wiki/rest/api`.
  Произвольный Server/DC context path автоматически не выводится.
- Confluence URL вида `/pages/viewpage.action?pageId=123456` не преобразуется
  текущим adapter. Используйте поддерживаемый URL с `/pages/123456/...` или
  `/display/SPACE/Title`; иначе будет Raw HTTP/HTML fallback.
- Redirect на отдельный SSO-host не превращает браузерную сессию в API-сессию.
  Даже allowlist redirect требует отдельного совпадающего правила и не
  реализует OAuth/cookie flow.
- HTTP proxy, mTLS client certificate и Kerberos/NTLM не входят в текущие типы
  авторизации. Разместите перед продуктом согласованный HTTPS gateway либо
  расширьте transport отдельной реализацией.

## 10. Короткий security checklist

- Используется отдельная read-only сервисная учётная запись.
- Secret находится в credential store, а не в YAML, prompt или логах.
- Указаны точные hostnames и минимальные `allowPaths`.
- Для внутренних адресов заданы узкие `Allowed CIDRs`; лишние классы сети
  выключены.
- Оставлен `same-origin` redirect, если иной маршрут не подтверждён.
- Jira comments/links включены только когда действительно нужны.
- **Diagnose** и **Test** прошли для каждой системы и каждого DNS-сценария.
- После настройки проверен реальный `web_fetch` из пользовательской сессии.
