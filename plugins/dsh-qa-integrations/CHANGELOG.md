## 0.8.3 (2026-09-23)

### 🩹 Fixes

- Domain expert execution now fails closed when the runtime cannot enforce an ([7843693](https://github.com/xarleyn/dsh-plugins/commit/7843693))
  explicitly denied tool. A refusal no longer retries with a list that accidentally
  puts the denied name back into the worker's allowed set.

  The integrations operator card keeps new instance and service-credential rows
  as local drafts until they are complete. Controlled profile fields no longer
  snap back to the stored value, and deleting a stored instance cannot shift an
  unfinished draft into the payload sent to the Host.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.12.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.2 (2026-09-22)

### 🩹 Fixes

- The operator card keeps what was typed, and a provider problem is visible. ([0a70f14](https://github.com/xarleyn/dsh-plugins/commit/0a70f14))

  Two halves of one complaint: the card is where a deployment's shared connection
  settings are edited, and it lost work while the roster refreshed — a half-typed
  base URL or token was gone the moment the list re-rendered, so a slow provider
  made the card feel like it was fighting the operator. Drafts are now kept per
  provider and survive a refresh and a switch between rows.

  The other half is silence: a provider that answered with a shape the plugin did
  not expect, or refused the credential, left its row looking configured, and the
  operator only found out from a chat that could not read anything. The row now
  carries the failure it produced, with the provider's own words, so a bad
  credential reads as a bad credential rather than as a plugin that does nothing.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.2

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.1 (2026-09-22)

### 🩹 Fixes

- Ручная приёмка провайдеров перестала быть разовой раскопкой. ([a9c00d2](https://github.com/xarleyn/dsh-plugins/commit/a9c00d2))

  Пакет везёт регрессионный тест инструмента `scripts/probe-provider.mjs` из
  корня репозитория: он держит два правила, на которых стоит ручная проверка
  провайдера против живого инстанса, — что каждый провайдер объявляет чтение
  идентичности, которым можно подключиться, и что проба не печатает секрет,
  который ей передали. Сам ход ручной проверки (пошаговый плейбук, матрица
  продуктов Atlassian, негативные случаи и чек-лист «второй продукт у того же
  провайдера») описан в `docs/MANUAL_VERIFICATION.md`.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.0 (2026-09-22)

### 🚀 Features

- Jira и Confluence теперь работают не только с Atlassian Cloud, но и с ([c10fd19](https://github.com/xarleyn/dsh-plugins/commit/c10fd19))
  самохостящимися Server / Data Center. Тип развёртывания объявляет оператор в
  конфиге сайта (`jira.sites[].deploymentType`, `confluence.instances[].deploymentType`:
  `cloud`, `server` или `data-center`); значение по умолчанию — `cloud`, поэтому
  существующие конфиги продолжают работать без правок.

  Для Jira Server / Data Center провайдер ходит по `/rest/api/2` с личным токеном
  доступа (Personal Access Token) в заголовке `Bearer`, без почты аккаунта; поиск
  задач идёт через классический `/search` с пагинацией по offset, а справочник
  людей — через `username=`, потому что эта Jira фильтрует по логину, а не по
  accountId. Для Confluence Server / Data Center — свой v1 API под `/rest/api` (в том
  числе если вики живёт за контекстным путём: он задаётся в `baseUrl`), тела страниц
  приходят в storage-разметке и рендерятся в текст, комментарии обоих видов лежат в
  одной коллекции и различаются по маркеру места.

  Конфигурация, которая объявила сайт одним продуктом, а он отвечает другим,
  отклоняется на подключении с подсказкой, какое значение поставить, — вместо
  прежнего отказа «Data Center не поддерживается». В карточке подключения для
  такого сайта спрашивают личный токен доступа и не спрашивают почту, а в
  операторском редакторе у каждого сайта появился выбор типа развёртывания.


### 🩹 Fixes

- The integration store is closed when the plugin goes away. ([e03a44b](https://github.com/xarleyn/dsh-plugins/commit/e03a44b))

  `IntegrationRepository.close()` existed and nothing called it: the plugin's
  teardown removed the tools and closed the logger, leaving the SQLite handle and
  its WAL open for whatever ran next. A reload therefore handed the new instance
  a database that was still held — the stray `qa-integrations.db`, `-shm` and
  `-wal` files a local run leaves in the plugin directory are what that looks
  like from the outside.

  Disposal now closes the store, so a reload re-opens the file instead of
  inheriting the previous instance's lock.

- One owner per shared provider policy, and no empty continuation cursor. ([06d6635](https://github.com/xarleyn/dsh-plugins/commit/06d6635))

  The seven integrations used to carry their own copy of the same helpers: reading
  a field out of an upstream answer, refusing a malformed argument, the retry loop
  and bounded read of a transport, classifying a failure, naming a configuration
  error. The copies had already drifted — the ones that read a string field
  disagreed about an empty one — so the same question now has a single answer per
  policy, in `providers/shared/` for upstream payloads, paths, HTTP and health,
  and in `coerce.ts`/`errors.ts` for arguments and errors. Integrations that
  genuinely differ pass a parameter or keep their own named helper; the package
  gate refuses a provider that declares a shared policy again.

  The behaviour a caller sees: an empty continuation token from Jira is no longer
  answered as a cursor. Jira can send `nextPageToken` present but empty, and the
  cursor a tool accepts is validated as non-empty, so an answer carrying `""` handed
  a caller a value whose only possible use was an `InvalidRequest`; the page is
  simply the last one now. The same emptiness rule covers every provider.

  While the policies were moving, the integration's specifications moved from
  `docs/SPEC-<topic>.md` to `docs/specs/<topic>.md`, and `SPEC.md` — the document
  meant to be the single entry point — now links all of them.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.7.0 (2026-09-21)

### 🚀 Features

- Give `bitrix_search_crm` the filters the audit kept reaching for, and pin the page order so offset paging stops repeating rows. ([20eea44](https://github.com/xarleyn/dsh-plugins/commit/20eea44))

  The tool could only narrow by title substring and assignment, so typical questions ("open deals in this funnel", "what moved recently") degenerated into paging through the archive from the first page of ten thousand. The schema now carries `stageId`, `categoryId`, `openOnly` (deals only — the universal item API exposes `closed` for deals), `createdSince`, `updatedSince`, `orderBy` (`id`/`createdTime`/`updatedTime`) and `orderDir`. Every search now sends an explicit deterministic order: offset paging over an unspecified order is what produced identical pages at different offsets. An empty `query` now fails with the repair named in the message — `query is invalid: a non-empty title substring …` — instead of a bare `query is invalid` that one session retried verbatim; the tool description also points at `bitrix_get_crm_stage_history` for the "sitting in a stage too long" question the search could not express.

- Add `bitrix_add_crm_timeline_comment`, the provider's first write tool, behind an operator switch that defaults to off. ([609d60d](https://github.com/xarleyn/dsh-plugins/commit/609d60d))

  QA tasks kept asking the agent to "add a note to the deal", and the agent — holding only read tools — promised a write it could not perform. The new tool adds exactly one comment to the timeline of a lead, deal, contact or company (`crm.timeline.comment.add`); smart processes and every other mutation stay out of the surface. It mounts only when the deployment sets `bitrix24.crmCommentWrite: true`, rides the new `crm.comment.write` capability, and even then starts policy-denied until the capability is explicitly allowed for the integration. Three gates, because Bitrix24 has no read-only webhook scope: a `crm`-scoped webhook can write on its own, so the flag — not the scope probe — is what bounds the deployment, and the policy is what bounds the user. The read catalog of thirty-nine tools is unchanged and stays mounted whatever the flag says.

- An operator card for the deployment configuration, live in "Plugins → Plugin ([1a921b5](https://github.com/xarleyn/dsh-plugins/commit/1a921b5))
  configuration".

  Until now every deployment knob — provider switches, instance and site lists,
  the TeamCity address with its network policy, managed service credentials —
  lived only in the profile's composition row, and the Host settings page showed
  a card that asked for a QA sign-in, because connections belong to accounts. An
  operator who just wanted to flip a capability had to edit yaml and restart.

  The plugin now installs its configuration as a real settings namespace and
  mounts an operator card on it, beside the user surfaces. The card covers the
  whole resolved configuration: the general knobs (enabled, timeouts, response
  and audit budgets, the Bitrix24 portal suffixes), every provider's capability
  switches and limits, the instance and site lists with id/label/address rows,
  the TeamCity server address and its address policy, managed service credential
  profiles with their resource boundaries and deny policy, and the per-provider
  credential-help overrides. Every field shows whether the user layer overrides
  the composition row, one button clears the layer back to yaml, and a refused
  value is reported on the card instead of stored.

  Edits apply to the running service as they are committed: the broker is
  re-pointed at the freshly resolved provider set, and the tool mount follows the
  enabled flag and the one write capability. The connection store and its master
  key are the deliberate exception — connections and wrapped secrets belong to
  the boot path, so re-pointing them warns and waits for a Host restart instead
  of reopening the store under running connections. A deployment without a
  settings provider behaves exactly as before, booting on the composition row.

- Managed service credentials for every provider, not just GitLab and TeamCity. ([aaa1420](https://github.com/xarleyn/dsh-plugins/commit/aaa1420))

  The deployment-managed shared read-only account existed for two of the seven
  integrations: a contractor without a corporate GitLab account, or an intern no
  one issued a TeamCity token, could not connect at all. The provider contract
  was already generic — the broker resolved the mode and the boundary for anyone
  — but only two providers classified their operations, so only two offered the
  checkbox.

  Bitrix24, Jira, Confluence, Test IT and Weblate now implement the full
  provider side: per-operation security classification (effect, sensitivity,
  service-safety, resource boundary), capability service states, instance
  portal resolution, a probe-only credential health check, and execute-time
  enforcement that runs the ceiling first, then the boundary, then the
  provider-specific filters. Each provider names its own boundary vocabulary:
  `projects` for Jira (project keys), Test IT (project ids) and Weblate (project
  slugs), `spaces` (space keys) for Confluence, and `portals` for Bitrix24,
  which has no project tree at all — a service webhook must answer on the portal
  the profile names, and the profile's secret there is a full incoming-webhook
  URL whose host the broker derives itself. The connect cards gained the shared
  service UI: the pre-checked "use the service token" box when the deployment
  defaults to it, a connect form without a secret field, the mode row with the
  switch buttons, and the seven service error explanations.

  Sensitive reads stay personal everywhere: CI logs and artifact bodies on
  GitLab/TeamCity as before, and now the Bitrix24 people directory, chats,
  open lines, call transcripts, calendars and Drive files, the Test IT
  attachments (metadata included — a global attachment id cannot be mapped to a
  boundary project, so it fails closed), and Jira attachment listings. Catalogs
  without a log-like read (Confluence, Weblate) report no sensitive capability.
  Everything a provider update adds without an explicit classification stays
  denied, as before.


### 🩹 Fixes

- The operator card reads as grouped blocks instead of one flat run of fields. ([945ac51](https://github.com/xarleyn/dsh-plugins/commit/945ac51))

  Every provider section used to be a single grid of fourteen to twenty-three
  controls in source order: the provider switch, the instance editor, the
  capability toggles and the numeric limits all carried the same weight, so a two
  column layout could put an instance row next to "Профиль: чтение" and the
  knobs a reader rarely touches sat between the ones they came for. Each section
  now has four labelled blocks — «Провайдер», «Подключение» (connection editors
  own the full width), «Что доступно агенту» as a checklist whose box leads the
  label, and «Ограничения и повторы» folded away until someone asks for it.
  Capability keys and their defaults are unchanged, only the headings that say
  what belongs with what are new.

  A collapsed section also says what it holds: `включён · 1 инстанс · доступно
  7 из 7`, computed from the same values the toggles show, so a reader can see
  which provider is off or half-open without expanding seven sections. Field
  captions are now real `<label>`s tied to their inputs, which makes a caption
  click land in the field and lets assistive technology name it.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.10.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.6.0 (2026-09-18)

### 🚀 Features

- Managed service credentials for GitLab and TeamCity. ([bc39062](https://github.com/xarleyn/dsh-plugins/commit/bc39062))

  A deployment can now publish one read-only credential it owns, so a user who
  cannot mint a personal access token — or does not want to — can still work
  through the integration layer. A profile is deployment configuration: the
  provider instance it belongs to, the label users see, the mounted secret, and
  the resources it may read. A new connection starts on that credential when the
  deployment says so; an existing connection keeps the credential it already had,
  because an upgrade must never move somebody onto a shared account.

  The shared credential is not simply read-only. Every operation carries security
  metadata — effect, sensitivity, and whether the managed credential may reach it —
  and service mode runs only what is a read, of normal sensitivity, explicitly
  classified as safe. Writes, admin actions, permission and credential management
  stay unreachable even when the service token upstream allows them, and sensitive
  reads stay personal-only: GitLab CI job logs, TeamCity build logs and text
  artifacts. A confidential GitLab issue is never returned through the shared
  account — not by id, not in a listing, and not in a search — and a search of
  notes, where the parent's confidentiality cannot be checked at all, stays
  personal. An operation the provider does not classify is denied, so a tool added
  by a later provider update is not reachable through the shared credential until
  someone classifies it on purpose. An administrator can narrow the ceiling, never
  widen it.

  Because the shared account sees far more than one user should, every profile
  carries a resource allowlist that is a hard upper bound. A service-mode call
  resolves the project it names against that list, a build addressed by its id is
  first resolved to its owning project, and a listing that names no resource is
  refused rather than answered with the whole instance view. Expanding a GitLab
  group asks for the group's own projects and checks every one that comes back, so
  a project shared into it from elsewhere stays out. A user may narrow the list
  further from the card; a selection outside it is dropped rather than stored.

  There is no fallback in either direction: a `403` in personal mode is a denial
  and is not retried with the service account, and the reverse holds too. A stored
  personal credential stays inactive while a connection runs on the service
  credential, and either side can be chosen later — switching bumps the binding
  revision that everything derived from the previous identity is keyed by. The
  secret is read from its file on each call and identified by a content hash, so
  rotating a mounted secret takes effect on the next call without anyone
  reconnecting. Upstream only ever sees the service account, so every audit row
  records the authenticated QA user, the operation, the credential source and the
  service profile.

  GitLab's single `ci.read` capability split in two: `ci.metadata.read` for
  pipelines, jobs and statuses, and `ci.logs.read` for what a job printed, which
  is personal-only. The deployment switches follow (`ciMetadataRead`,
  `ciLogsRead`); the pre-split `ciRead` still works and governs both halves, and a
  connection that stored the old capability id is repaired at startup with the
  policy it had set.

  Bitrix24, Jira, Confluence, Test IT and Weblate are unchanged: they offer no
  service mode, and their cards show nothing about it.

- Give `bitrix_search_crm` the filters the audit kept reaching for, and pin the page order so offset paging stops repeating rows. ([6a8d677](https://github.com/xarleyn/dsh-plugins/commit/6a8d677))

  The tool could only narrow by title substring and assignment, so typical questions ("open deals in this funnel", "what moved recently") degenerated into paging through the archive from the first page of ten thousand. The schema now carries `stageId`, `categoryId`, `openOnly` (deals only — the universal item API exposes `closed` for deals), `createdSince`, `updatedSince`, `orderBy` (`id`/`createdTime`/`updatedTime`) and `orderDir`. Every search now sends an explicit deterministic order: offset paging over an unspecified order is what produced identical pages at different offsets. An empty `query` now fails with the repair named in the message — `query is invalid: a non-empty title substring …` — instead of a bare `query is invalid` that one session retried verbatim; the tool description also points at `bitrix_get_crm_stage_history` for the "sitting in a stage too long" question the search could not express.

- Add `bitrix_add_crm_timeline_comment`, the provider's first write tool, behind an operator switch that defaults to off. ([7e70a4f](https://github.com/xarleyn/dsh-plugins/commit/7e70a4f))

  QA tasks kept asking the agent to "add a note to the deal", and the agent — holding only read tools — promised a write it could not perform. The new tool adds exactly one comment to the timeline of a lead, deal, contact or company (`crm.timeline.comment.add`); smart processes and every other mutation stay out of the surface. It mounts only when the deployment sets `bitrix24.crmCommentWrite: true`, rides the new `crm.comment.write` capability, and even then starts policy-denied until the capability is explicitly allowed for the integration. Three gates, because Bitrix24 has no read-only webhook scope: a `crm`-scoped webhook can write on its own, so the flag — not the scope probe — is what bounds the deployment, and the policy is what bounds the user. The read catalog of thirty-nine tools is unchanged and stays mounted whatever the flag says.

- Explain the credential field: where each provider's token comes from, what to ([4561073](https://github.com/xarleyn/dsh-plugins/commit/4561073))
  grant it, and where the deployment can point somewhere else.

  Every provider card ends in a secret field, and until now each one explained
  itself in its own words — a sentence in the card, or nothing at all where the
  answer was long. That copy is now metadata declared next to the provider
  (`src/providers/<id>/credential-help.ts`): the credential mechanism, the page
  that issues the credential, the vendor documentation, the required permissions
  and the steps, with the trigger wording picked from the mechanism, so an OAuth
  connection is not told to "create a token" and a Bitrix24 incoming webhook says
  what it actually needs. The cards lost the guidance that duplicated it; the
  sentence about how the secret is stored stays where it was.

  The help reaches the browser on the authenticated `qaIntegrations/providers`
  call, already merged with the deployment's overrides. It is metadata only: no
  credential value, snapshot or authorization result travels in the payload, and
  the credential architecture is untouched — secrets stay write-only, encrypted
  at rest and invisible to the browser. Because the addresses live in the Host,
  a deployment can replace any of them per provider through
  `credentialHelp.<id>` in its config — corporate GitLab, Jira Data Center, an
  internal wiki, a proxy gateway — or turn the help off for one provider without
  touching the field.

  Failure stays proportionate. Metadata is never a runtime dependency: without it
  the card renders the plain field; an unusable address hides only its own link
  and is reported once at startup as `credential-help.override`; an unknown
  mechanism degrades to `custom`; and a vendor page that moved cannot fail a
  connection. Only `http(s)` renders — `http:` only for loopback, private and
  self-hosted hosts — and external links open with `noopener noreferrer`.

  The gate follows the same line: `verify:package` asserts that every provider
  ships its declared help and that no declared address reaches the client bundle,
  and the bundle's design tokens are checked against the tokens the Host actually
  defines.

- Add a sixth provider to the integrations plugin: Test IT, read as the connected ([383878b](https://github.com/xarleyn/dsh-plugins/commit/383878b))
  QA user through their own API token. It ships twenty-two read-only tools — the
  projects and sections of the test library, test cases, checklists and shared
  steps with their steps, attributes and tags, the change log and comments of a
  case, test plans with their per-plan summary, runs with the test points and
  results inside them, single results with their messages and traces, attachment
  metadata, a bounded text read of a small attachment, autotests and the
  configurations a result is recorded against.

  A Test IT installation is operator configuration: `testit.instances` lists the
  Cloud tenants and on-premise TMS servers this deployment allows, the connect form
  only picks from that list, and the address is re-resolved from config on every
  call, so removing or repointing an instance closes existing connections too. The
  token travels as the `PrivateToken` authorization header and nowhere else.

  The catalog holds GET endpoints only, which is what this package's read-only
  guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
  so the provider reaches the same ground through the GET surface — a run's test
  points instead of its statistics, a plan's summary instead of a filtered
  aggregate — and the tools it cannot back that way are listed as missing in the
  README rather than smuggled in. Three of the reads it does use are the endpoints
  Test IT marks deprecated; they are the only GET reads of those collections, and a
  version that drops them answers an honest "not available here".

  Test IT text is untrusted content: descriptions, steps, comments, messages and
  traces reach the model as bounded blocks under `untrustedContent`, and an
  attachment is described by Test IT itself before a byte is requested, so archives,
  images and oversized files are refused by the server's own account of the file.

- Add a sixth provider to the integrations plugin: Weblate, the localization ([0a50bde](https://github.com/xarleyn/dsh-plugins/commit/0a50bde))
  platform, read as the connected QA user. It ships nineteen read-only tools —
  the connection itself, projects, components, languages of a component, string
  search, a single string with every plural form and its state, the comments and
  suggestions left on it, checks that fail, statistics and change history — and
  the catalog carries no operation that could change Weblate state, so
  suggestions, comments, edits, approvals, translation files and the repository
  stay out until the confirmation framework exists.

  A connection is one of the operator's configured instances plus a Weblate API
  token, kept in one encrypted credential; the connect form picks the instance
  and never types a host, and the address is re-resolved from deployment config
  on every call, so an instance the operator removes fails closed instead of
  moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
  as a label — personal or project-scoped — and are never treated as a permission
  check.

  Weblate's search grammar is composed by the provider from validated filters
  rather than accepted from the model: values are quoted and escaped, states come
  from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
  from the page number of the upstream `next` link, only when that link points at
  the configured instance. Every answer that carries upstream-authored text — a
  source string, a translation, a comment, a change — is marked as untrusted
  external content, and localization strings handed to the model are bounded and
  say when they were cut.


### 🩹 Fixes

- Expose account integrations as a feature-owned Plugins tab so the original DSH ([84b3c4c](https://github.com/xarleyn/dsh-plugins/commit/84b3c4c))
  settings UI can open them from authenticated LAN browsers without depending on
  loopback-only settings discovery.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.9.0
- Updated @yadsh/dsh-plugin-kit to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.0 (2026-09-17)

### 🚀 Features

- Keep connections and their audit trail in a database instead of one JSON ([e9a1e66](https://github.com/xarleyn/dsh-plugins/commit/e9a1e66))
  document.

  The store was read, parsed and rewritten whole on every operation, and it held
  the audit trail — the part that grows with usage — inside the same document as
  the connections: every lookup parsed every audit row ever written, and the
  broker appends a row per tool call. A store with a working audit trail made
  each call more expensive than the last. Connections, encrypted credentials,
  per-operation policies and the audit trail are tables now, so a lookup reads the
  row it asks for and a call appends the row it produces.

  Two bounds keep the audit trail finite: `auditRetentionDays` (90 by default,
  0 to keep by age only) and a hard cap of the newest 5000 rows whatever the age
  bound says. Both are applied as rows are written.

  The pre-0.8.0 `qa-integrations.json` is imported on first use — connections,
  credentials, policies and audit — verified inside the transaction, and renamed
  to `qa-integrations.json.migrated-<ISO>`. A leftover file never overwrites a
  live connection: the operator's working credential wins, and the file is left
  where it is.

- Add a sixth provider to the integrations plugin: Test IT, read as the connected ([6ef77da](https://github.com/xarleyn/dsh-plugins/commit/6ef77da))
  QA user through their own API token. It ships twenty-two read-only tools — the
  projects and sections of the test library, test cases, checklists and shared
  steps with their steps, attributes and tags, the change log and comments of a
  case, test plans with their per-plan summary, runs with the test points and
  results inside them, single results with their messages and traces, attachment
  metadata, a bounded text read of a small attachment, autotests and the
  configurations a result is recorded against.

  A Test IT installation is operator configuration: `testit.instances` lists the
  Cloud tenants and on-premise TMS servers this deployment allows, the connect form
  only picks from that list, and the address is re-resolved from config on every
  call, so removing or repointing an instance closes existing connections too. The
  token travels as the `PrivateToken` authorization header and nowhere else.

  The catalog holds GET endpoints only, which is what this package's read-only
  guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
  so the provider reaches the same ground through the GET surface — a run's test
  points instead of its statistics, a plan's summary instead of a filtered
  aggregate — and the tools it cannot back that way are listed as missing in the
  README rather than smuggled in. Three of the reads it does use are the endpoints
  Test IT marks deprecated; they are the only GET reads of those collections, and a
  version that drops them answers an honest "not available here".

  Test IT text is untrusted content: descriptions, steps, comments, messages and
  traces reach the model as bounded blocks under `untrustedContent`, and an
  attachment is described by Test IT itself before a byte is requested, so archives,
  images and oversized files are refused by the server's own account of the file.

- Add a sixth provider to the integrations plugin: Weblate, the localization ([8a92740](https://github.com/xarleyn/dsh-plugins/commit/8a92740))
  platform, read as the connected QA user. It ships nineteen read-only tools —
  the connection itself, projects, components, languages of a component, string
  search, a single string with every plural form and its state, the comments and
  suggestions left on it, checks that fail, statistics and change history — and
  the catalog carries no operation that could change Weblate state, so
  suggestions, comments, edits, approvals, translation files and the repository
  stay out until the confirmation framework exists.

  A connection is one of the operator's configured instances plus a Weblate API
  token, kept in one encrypted credential; the connect form picks the instance
  and never types a host, and the address is re-resolved from deployment config
  on every call, so an instance the operator removes fails closed instead of
  moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
  as a label — personal or project-scoped — and are never treated as a permission
  check.

  Weblate's search grammar is composed by the provider from validated filters
  rather than accepted from the model: values are quoted and escaped, states come
  from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
  from the page number of the upstream `next` link, only when that link points at
  the configured instance. Every answer that carries upstream-authored text — a
  source string, a translation, a comment, a change — is marked as untrusted
  external content, and localization strings handed to the model are bounded and
  say when they were cut.

- Add a fourth provider to the integrations plugin: Confluence Cloud, read as the ([1abee9d](https://github.com/xarleyn/dsh-plugins/commit/1abee9d))
  connected QA user. It ships eight read-only tools — the connected account and
  site, typed CQL search, a page with its body rendered from Atlassian Document
  Format, page comments with replies, attachment metadata, page versions and
  spaces — and the catalog carries no operation that could change Confluence
  state.

  A connection is an operator-configured site plus an Atlassian API token and the
  account e-mail, kept together in one encrypted credential, and a model tool can
  never name a site, an account or a credential. The site address is re-resolved
  from deployment config on every call, the space allowlist
  (`confluence.allowedSpaces`) is enforced on search and on direct reads alike,
  and every page or comment body reaches the model as untrusted content under its
  own key.

  A search accepts its modification window either as an absolute day or as a span
  counted back from today (`-7d`, `-2w`, `-1m`, `-1y`), resolved against the
  provider's own clock, so an agent whose prompt carries no clock can still ask
  what changed this week.

- Stop retrying GitLab calls the deployment itself timed out, and name a TLS refusal as such. ([3030464](https://github.com/xarleyn/dsh-plugins/commit/3030464))

  The GitLab transport folded every failed fetch — including the abort of its own
  per-request deadline — into a single `ProviderUnavailable` error and spent a
  retry on it. A slow GitLab therefore waited for `timeout × (retries + 1)`
  before the user saw anything, and an untrusted certificate surfaced under the
  same "provider is unavailable" reason as a network outage, sending the operator
  to check reachability instead of the trust store.

  The transport now shares the TeamCity transport's failure classification: an
  aborted deadline is reported as `UpstreamTimeout` and is never re-sent, a
  failed TLS handshake is reported as `TlsFailure`, and only genuinely transient
  network faults are retried. The GitLab settings card carries the same
  human-readable explanations for the two new reasons that the TeamCity card
  already showed. The TeamCity provider's behavior is unchanged.

- Add a fourth integration provider, `jira`. A QA user connects their own ([4183b83](https://github.com/xarleyn/dsh-plugins/commit/4183b83))
  Atlassian account with an API token and gets a read-only catalog of eight tools:
  the connected identity and site; issue search over projects, statuses,
  assignee/reporter, labels and dates; one issue with its description, relations,
  attachment metadata, a comment count and its custom fields; the comments of an
  issue with their visibility; attachment metadata; the transitions available to
  the connected user; one project; and the site's field catalog.

  Sites are operator configuration, never user input: the connect form picks from
  the configured list and sends the e-mail and the token alone, so an arbitrary
  hostname can never reach the broker. A site address is validated at config load
  (HTTPS unless a deployment opts into plain HTTP for a lab, no credentials or
  query in the URL, stable id) and is not stored in the credential — it is
  re-resolved on every call, so removing or repointing a site closes the
  connections made against it instead of silently redirecting a token. The token
  travels as HTTP Basic over `email:token` in the `Authorization` header of a GET
  that never follows a redirect, and the credential is refused outright when it is
  not an Atlassian API token — a pasted URL, a `email:token` pair or a YAML snippet
  never leaves the process.

  The model gets no JQL. Every tool carries typed filters, and the provider builds
  one query from them: values are quoted as JQL string literals with the quote and
  the backslash escaped, control characters are refused, project and issue keys are
  shape-checked, a name where Jira needs an account id is refused (Jira would
  answer an empty page instead), labels are ANDed, and a search without a single
  filter is refused rather than turned into "every issue of the site". Search reads
  the enhanced endpoint Jira Cloud serves today (`/rest/api/3/search/jql`) with
  Jira's own continuation token as the cursor, keeps the page inside the
  deployment's ceiling and Jira's own 100 rows, and never walks pages by itself.
  Issue bodies arrive as Atlassian Document Format and are rendered to bounded
  markdown-like text (headings, lists, code, links, mentions, tables, media
  markers) — a JSON tree and an embedded card are never handed to the model, and
  nothing a node points at is fetched. Custom fields are named from the site's
  field schema, read after the issue answered and never cached, because the same
  site answers a different field list to two users with different permissions.

  The filter vocabulary is the one a corporate Jira is actually asked about, so a
  search can move off a query-string engine without losing questions: project, issue
  type, status and its category (`Done` covers every terminal status, whatever the
  workflow calls it), priority, resolution, components, labels (all of them, not
  any), fix and affected versions including "none set" and "set", assignee and
  reporter, created/updated bounds in both directions, and custom fields either by
  the id the field catalog reported or by an alias the deployment declared. Dates
  take absolute values and Jira's own relative
  tokens (`-3w`, `-2d`), a free-text query is either every word or the exact phrase
  (with each term its own escaped clause, so an `OR` inside a phrase stays a word),
  and the history of one issue is readable through `include: ["changelog_summary"]`
  — bounded to twenty field changes and honest about which of the two cuts
  happened. A person is accepted as `me`, as an account id, or as a name: the name
  is resolved through the site's own user directory, and a name nobody matches or
  several people share is refused with what to do next instead of being spent on a
  query that quietly answers "no such issues".

  `jira.fieldAliases` is where an instance's custom fields get their names: which
  of a site's fields carries "the product" is knowledge about that site, so this
  package carries no field id at all, the mapping is validated when the config is
  resolved (a typo fails the load rather than answering nothing), an unknown name
  is refused together with the aliases that do exist, and `jira_get_fields` hands
  the model the aliases it may use.

  The catalog is an explicit allow-list of Jira Cloud read endpoints, asserted by
  the package gate along with the `GET` method of every entry, the absence of the
  legacy `/search` endpoint Atlassian removed, and the absence of any JQL argument
  in a tool schema. The reads the provider makes beside an operation — the
  deployment type at connect and the people directory behind a name filter — are
  declared in the same allow-list. A deployment type check refuses a Data Center
  instance at connect instead of pretending the Cloud API is compatible.
  Capabilities are bounded by the deployment switches alone (`identity.read`,
  `issues.read`, `comments.read`, `attachments.read`, `transitions.read`,
  `projects.read`, `fields.read`): Jira reports no granted scopes for an API token
  and probing with a write is not an option, so the site's own permissions decide
  upstream and a refusal stays a refusal.

  OAuth 2.0 3LO with rotating refresh tokens, the shared Atlassian
  account/resource layer the specification describes, the workspace-to-project
  binding, the pending-action confirmation flow every write needs, attachment
  content download, a typed filter over the change history (`WAS`/`CHANGED`), the
  caching and per-principal rate limiting stay out of this release; the provider's
  README states each deferred item and what stands in for it today.


### 🩹 Fixes

- Align provider examples and fixtures with the documented public placeholder ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  conventions. No runtime behavior changes.

- Expose account integrations as a feature-owned Plugins tab so the original DSH ([9bc334e](https://github.com/xarleyn/dsh-plugins/commit/9bc334e))
  settings UI can open them from authenticated LAN browsers without depending on
  loopback-only settings discovery.

- Write the operator-configured TeamCity address down where the deployment's ([66a4430](https://github.com/xarleyn/dsh-plugins/commit/66a4430))
  configuration is documented. The "how TeamCity connects" section, the TeamCity
  config example and the end-to-end deployment example all show
  `teamcity.serverUrl` now, and the walkthrough no longer tells users to type the
  server into the connect form — the address is one per stand and comes from the
  deployment, while the form asks for the token alone.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.8.0
- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-16)

### 🚀 Features

- Move the TeamCity address out of the connect form and into the deployment's ([4694ade](https://github.com/xarleyn/dsh-plugins/commit/4694ade))
  configuration. One TeamCity serves the whole stand, so asking every user to type
  the same host only invited a broker pointed at a host of the caller's choosing;
  `teamcity.serverUrl` is now operator input, canonicalized and checked against
  the address policy while the config is resolved, re-checked on every call, and
  never stored in the credential. Repointing or removing it closes every
  connection made against the old value.

  The card shows the configured address as a line of text and asks for the token
  alone. A deployment that mounts TeamCity without an address is valid but inert:
  the card says there is nothing to connect to instead of offering a form whose
  save would be refused. Existing connections keep working — a credential stored
  with the address the old form collected is accepted and read for its token, and
  the token is now spent against the deployment's address.

  `teamcityServer` joins the plugin's RPCs so a card can learn the address without
  one; it is token-gated like the GitLab instance list, because the address of a
  stand's CI is not something an unauthenticated caller needs.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.4

## 0.3.2 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.3

## 0.3.1 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.2

## 0.3.0 (2026-09-16)

### 🚀 Features

- Mount the integrations as a card of the host's "Plugin configuration" tab. A ([3b2f09b](https://github.com/xarleyn/dsh-plugins/commit/3b2f09b))
  connection belongs to a QA account, and until now the only surface that could
  carry it was the `Интеграции` page inside the QA settings dialog: the card of
  the plugins list is dispatched by a settings namespace, and this plugin served
  none. The deployment now installs a mount-only `qa-integrations` section (the
  provider switches, the address policy and the vault path stay composition-time
  decisions, so the section carries nothing an operator could edit), and the
  browser half registers the card under that namespace through the shared
  `dsh-plugin-card` shell.

  The card renders one provider card per mounted provider, exactly as the QA page
  does — both mounts share the component — and reads the account through the new
  `qaUserSession` client service of `@yadsh/dsh-qa-surface`. Without a signed-in
  QA account it says so instead of showing connect forms whose every call would be
  refused, and it stays closed (and therefore reads nothing) until it is opened.

  The credential forms gained the fix they needed to be usable at all: the primary
  button asked for `--dsw-alias-label-on-brand`, a token the DSH theme does not
  define, so the label inherited the card's own colour and the button rendered as
  a grey pill with no text. The status badge and the danger action were painted
  with two more non-existent tokens (`--dsw-alias-success-primary`,
  `--dsw-alias-error-primary`) that cost the status its green and the error box its
  border. All three now use the tokens the first-party cards use, and the package
  gate rejects the dead names.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-16)

### 🚀 Features

- Add a second integration provider, `gitlab`, and turn the settings section into ([50f0737](https://github.com/xarleyn/dsh-plugins/commit/50f0737))
  one card per mounted provider. The provider connects a QA user to their own
  GitLab identity with a personal access token and exposes a read-only catalog of
  23 tools: connection identity; project search and project cards; repository tree,
  file reads with metadata, commit lists, single commits and ref comparison;
  cross-GitLab search over projects, issues, merge requests, commits, code and
  comments; issues with their notes; merge requests with changed files,
  discussions, approvals and attached pipelines; and pipelines with their jobs and
  logs.

  Instances are operator configuration, never a user input: the connect form picks
  from the configured list, so an arbitrary hostname can never reach the broker.
  The instance address is validated at config load (HTTPS unless a deployment
  opts into plain HTTP for a lab, no credentials or query in the URL, stable id)
  and is not stored in the credential — it is re-resolved on every call, so
  removing or repointing an instance closes access to tokens minted for it instead
  of silently redirecting them. Requests are GET-only, never follow redirects, and
  carry the token in the `PRIVATE-TOKEN` header alone.

  Capabilities follow the scopes the token really reports: on connect and on every
  connection test the provider asks GitLab what the token holds
  (`/personal_access_tokens/self`) and offers `identity.read`, `projects.read`,
  `repository.read`, `search.read`, `issues.read`, `merge_requests.read` and
  `ci.read` only where the deployment switch and the token agree. A token that
  cannot read itself costs precision, not safety, because the deployment switches
  still bound the surface. Repository files and CI logs are size-bounded before
  they reach the model, binaries and oversized bodies answer with metadata and a
  truncation marker instead of raw bytes, diff text spends a shared character
  budget, and job logs pass through secret redaction — GitLab's own masking is a
  filter, not a promise.

  The write surface, OAuth with PKCE, the user-selectable project boundary, the
  pending-action confirmation flow, caching and webhooks stay out of this release;
  the provider's README states each deferred item and what stands in for it today.

  The shared engine stays provider-agnostic: `parseCredential` gained an optional
  non-secret options map so a connect form can name the instance a token belongs
  to, the error model gained `ResourceNotFound`, `RateLimited` and
  `ResultTooLarge`, and redaction learned the `glpat-` token shape. Package
  verification now asserts the GitLab catalog is read-only, that no tool schema
  carries a user, credential or instance selector, and that neither provider's
  name leaks into the shared modules.

- Extend the Bitrix24 integration from four tools to a read-only catalog of 39, ([a882f1e](https://github.com/xarleyn/dsh-plugins/commit/a882f1e))
  covering CRM context, employees and departments, chats and open lines, tasks,
  calendar and Drive. Each tool is one catalog operation with a validated,
  read-only argument set: CRM schema and funnels, stages and status dictionaries,
  activities with deadlines, timeline comments, stage history, product rows,
  duplicate lookup by phone or e-mail, requisites and AI call transcriptions;
  employee search by name, e-mail or department and the readable employee field
  list; chat search, recent dialogs, message search inside a chat, the chat
  attached to a CRM entity, task or calendar event, its participants and their
  profiles, and open-line dialog history; task search, single task cards, task
  change history, results and logged time; calendar events and free/busy lookup;
  and Drive full-text search, file metadata, storages and folder contents.

  Replace the two capabilities with one per Bitrix24 webhook scope — `crm.read`,
  `chat.read`, `openlines.read`, `user.read`, `department.read`, `tasks.read`,
  `calendar.read`, `disk.read` — and read the scopes the connected webhook was
  actually granted (`scope` method) on connect and on every connection test. The
  Settings card therefore lists a capability as available only when both the
  deployment switch and the portal agree, and a scope granted later in Bitrix24
  appears as a detected but disabled capability that the user enables themselves.
  Owner-scoped reads default to the connected Bitrix24 user, resolved server-side
  from the stored integration, never from a model argument.

  List operations now answer with a uniform `{ items, pagination }` envelope, so
  the model sees one response shape instead of six, and id-keyed responses such as
  open-line history are projected into ordered arrays. Capability labels come from
  the provider at runtime and the effective policy arrives as capability/mode
  pairs, so the Settings card renders a provider it has never heard of.

  The plugin is laid out as one directory per integration under
  `src/providers/`, with the shared engine — broker, repository, secret store,
  tool plumbing — naming no integration at all, which is what the next provider
  (Jira, GitLab, TeamCity) plugs into.

  Three Bitrix24 documentation ambiguities shape the surface: `user.search` is not
  called because its parameter table and its examples disagree about where filter
  keys belong, while `user.get` with `FILTER.NAME_SEARCH` is documented in one
  shape; tasks use the classic methods because REST 3.0 moved to `/rest/api` and
  filters tasks by id only, which cannot express "my open tasks"; and
  `imopenlines.session.open` is not exposed because its page never certifies it as
  read-only, the same dialog lookup being a documented get on
  `imopenlines.dialog.get`.

- Add a third integration provider, `teamcity`, as a read-only catalog of 13 ([83a4760](https://github.com/xarleyn/dsh-plugins/commit/83a4760))
  tools: server identity and version; project search; build configurations; build
  search by project, configuration, branch, status, state and date; one build in
  full; its version control changes; its failures — failed tests and build
  problems in one answer, because "why did this break" is one question; a bounded
  window of its build log; the build queue; investigations; agents; artifact
  metadata; and small text artifacts. Nothing in the catalog can change TeamCity
  state: trigger, retry, cancel, comment and tags wait for the pending-action
  confirmation the specification requires for them, and the parameters endpoints
  are never called, so secret build parameters cannot reach the model at all.

  Unlike GitLab's operator-declared instances, the TeamCity address is user input
  — the server is usually self-hosted — so it is governed by a deployment address
  policy instead of a list: `allowlist` mode with `allowedHosts`, `allowedCidrs`
  and `allowedPorts`, or `trusted-private` for a company network that trusts its
  own DNS. The policy is checked when the connection is stored and again on every
  call, so tightening it closes existing connections rather than only new ones;
  plain HTTP needs an explicit opt-in, ports are explicit (TeamCity's own 8111
  included), redirects are never followed, and the token travels only in the
  `Authorization` header. An empty policy is inert rather than fatal — the plugin
  logs it at startup instead of failing to load — while a typo in it fails loudly,
  because a silently dropped host pattern would leave users with no explanation.

  Log text and artifact text are treated as untrusted external content: the log is
  downloaded up to a byte budget, stripped of terminal control sequences and
  repaired Unicode, redacted, and cut to the requested lines, with `truncated` and
  `logTruncated` telling apart "the window was cut" from "the log is longer than
  what was downloaded". Artifacts are refused by name before a byte is requested
  when they are archives, images, binaries, documents or key material, binary
  bodies answer with metadata instead of bytes, and paths with `..`, absolute
  paths, backslashes, control characters and archive components (`a.zip!/b`) are
  rejected. Lists answer with the same `{ items, pagination }` envelope the other
  providers use, and the provider never follows `nextHref`: `pagination.hasMore`
  says the page was cut, page sizes stay inside the specification's caps, and a
  model that asks for more than the cap gets the cap rather than an error.

  The shared engine gained what this provider needed and nothing else: the error
  model learned `UpstreamTimeout` (a server that did not answer in time is worth
  retrying as it is) and `TlsFailure` (an untrusted certificate is an operator
  problem, not a user one), and redaction learned the shapes a CI job actually
  prints — `password=…`, `api_key: …`, `--token …` — because log text arrives as a
  plain string, where a field-name rule can never see it. Package verification now
  asserts the TeamCity catalog is read-only, that no tool schema carries a user,
  credential or server selector, and that the address policy is enforced on every
  call.

  TeamCity cannot report what a token was restricted to, so capabilities are
  bounded by the deployment switches and by TeamCity's own permissions, which
  surface as `ProviderPermissionDenied` — the provider never tries another
  credential. The address policy, rate limiting, caching, webhooks, automatic
  multi-page aggregation and the write surface stay out of this release; the
  provider's README states each deferred item and what stands in for it today.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-15)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.1

## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce principal-scoped user integrations for QA Surface with an initial ([0bf810f](https://github.com/xarleyn/dsh-plugins/commit/0bf810f))
  read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
  settings page, write-only manual webhook setup, envelope-encrypted secret
  storage, per-user policy and audit records, and four narrowly scoped CRM/chat
  tools whose schemas cannot select a user or credential.

  QA Surface gains a public client settings-section registry and owner-attested
  integration principal binding. Admin cross-user viewing, unowned sessions and
  subagents do not inherit access to another account's integration.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn
