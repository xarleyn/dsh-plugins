# dsh-qa-integrations: корневые тесты разложены по доменам — срез 28.09.2026

Артефакт задачи [#496](https://gitea.viki.xarleyn.local/dsh/dsh-plugins/issues/496)
(родительская — #476). Измеряющий признак карточки: файлов непосредственно под
`plugins/dsh-qa-integrations/tests/` — после прохода **0**.

| | |
| --- | --- |
| Срез переноса | `dsh-v0.1.7-rc` = `63a5e697` (база ветки `bot/496`) |
| Срез постановки задачи | `main` = `8c28237`, 56 корневых файлов |
| Разница срезов | на `63a5e697` в корне лежат 60 файлов: после постановки пришли `operator-test-ids.test.tsx` (#462), `operator-service-reach.test.ts` (#285), `service-boundary.test.ts` (#285) и `tool-service-ceiling.test.ts` (#285) |
| Метод | `git mv` + пересчёт только относительных спецификаторов; снимок suite до и после через vitest `--reporter=json`, сверка по полным заголовкам кейсов |
| Объём | 60 файлов: 55 test-файлов (85 `describe`, 534 кейса) и 5 fixture-файлов |
| Ассерты | не менялись: ни одно утверждение, ни один сценарий не переписаны |

## Карта доменов

Папкиproviders (`bitrix24`, `confluence`, `gitlab`, `jira`, `teamcity`, `testit`,
`weblate`) и `kernel` существовали до прохода и не перекладывались — к ним
только добавлены файлы, чей префикс дублировал имя папки. Остальные папки новые;
каждая повторяет границу в `src/`, а не выдумана по названию файла.

| папка | файлов | что покрывает |
| --- | --- | --- |
| `tests/client/` | 15 | клиентская поверхность (`src/client/*`): карточки провайдеров, карточка оператора, регистрация клиента и классический бандл |
| `tests/service-credentials/` | 9 | `src/service-credentials/*` плюс брокер (`src/broker.ts`): политики, потолок, rate limit, конфигурация, секреты, изоляция принципалов |
| `tests/shared/` | 4 | `src/providers/shared/*`: `credential-help`, `health`, `payload`, `service-boundary` |
| `tests/kernel/` | 3 | `src/providers/kernel/*`: адресация, бюджет чтения, HTTP-читалка |
| `tests/helpers/` | 1 | общий конформанс-набор провайдеров, который импортируют семь provider-папок |
| `tests/storage/` | 2 | слой хранения: `src/repository.ts` и `src/secrets/*` |
| `tests/tools/` | 3 | модельно-видимая поверхность тулов (`src/tools.ts`): каталог, безопасность, подпись потолка сервиса |
| `tests/utils/` | 3 | модули корня пакета: `src/coerce.ts`, `src/errors.ts`, `src/redaction.ts` |
| `tests/host/` | 1 | точка входа плагина (`src/index.ts`) |
| `tests/scripts/` | 1 | `scripts/probe-provider.mjs` из корня репозитория |
| `tests/bitrix24/` … `tests/weblate/` | 7 … 21 | уже разложенные provider-папки, дополненные их `*-catalog`, `*-service-credentials`, `*-service-boundary` и `*-service.helpers` файлами |

Клиентские и сервисные файлы разделены по импортам, а не по префиксу имени:
`operator-service-reach.test.ts` живёт в `client/`, потому что проверяет таблицу
заметок из `src/client/operator-service-reach.ts`, хотя сам крутится в node
окружении; `service-boundary.test.ts` — в `shared/`, потому что читает
`src/providers/shared/service-boundary.ts`, а не свой провайдер.

## Манифест переноса

`describe` и `кейсы` — из json-отчёта после переноса; до переноса те же значения
для того же файла (колонка сверена механически, см. «Проверка»). Кейсы считаются
развёрнутыми: `.each` даёт несколько записей.

| старый путь | новый путь | describe | кейсов | заголовки describe |
| --- | --- | --- | --- | --- |
| `tests/bitrix24-service-credentials.test.ts` | `tests/bitrix24/service-credentials.test.ts` | 1 | 14 | `Bitrix24 managed service credentials` |
| `tests/bitrix24-service.helpers.ts` | `tests/bitrix24/service.helpers.ts` | — | — | fixture, в suite не собирается |
| `tests/bitrix24-page.test.tsx` | `tests/client/bitrix24-page.test.tsx` | 1 | 4 | `Integrations Bitrix24 card` |
| `tests/card.test.tsx` | `tests/client/card.test.tsx` | 1 | 6 | `Integrations plugin card` |
| `tests/client-bundle.test.tsx` | `tests/client/client-bundle.test.tsx` | 1 | 1 | `classic browser bundle` |
| `tests/client-registration.test.ts` | `tests/client/client-registration.test.ts` | 1 | 2 | `integrations client entry` |
| `tests/confluence-page.test.tsx` | `tests/client/confluence-page.test.tsx` | 1 | 8 | `Integrations Confluence card` |
| `tests/credential-help-page.test.tsx` | `tests/client/credential-help-page.test.tsx` | 1 | 4 | `Integrations credential help` |
| `tests/gitlab-page.test.tsx` | `tests/client/gitlab-page.test.tsx` | 1 | 4 | `Integrations GitLab card` |
| `tests/jira-page.test.tsx` | `tests/client/jira-page.test.tsx` | 1 | 6 | `Integrations Jira card` |
| `tests/operator-card.test.tsx` | `tests/client/operator-card.test.tsx` | 1 | 17 | `integrations operator card` |
| `tests/operator-service-reach.test.ts` | `tests/client/operator-service-reach.test.ts` | 1 | 11 | `integrations operator card: service credential reach` |
| `tests/operator-test-ids.test.tsx` | `tests/client/operator-test-ids.test.tsx` | 1 | 3 | `operator control test ids` |
| `tests/service-card.test.tsx` | `tests/client/service-card.test.tsx` | 1 | 8 | `GitLab card: managed service credential` |
| `tests/teamcity-page.test.tsx` | `tests/client/teamcity-page.test.tsx` | 1 | 5 | `Integrations TeamCity card` |
| `tests/testit-page.test.tsx` | `tests/client/testit-page.test.tsx` | 1 | 6 | `Integrations Test IT card` |
| `tests/weblate-page.test.tsx` | `tests/client/weblate-page.test.tsx` | 1 | 9 | `Integrations Weblate card` |
| `tests/confluence-catalog.test.ts` | `tests/confluence/catalog.test.ts` | 2 | 12 | `Confluence capability catalog`; `Confluence tool surface` |
| `tests/confluence-service-boundary.test.ts` | `tests/confluence/service-boundary.test.ts` | 1 | 3 | `Confluence service boundary` |
| `tests/confluence-service-credentials.test.ts` | `tests/confluence/service-credentials.test.ts` | 1 | 20 | `Confluence managed service credentials` |
| `tests/gitlab-catalog.test.ts` | `tests/gitlab/catalog.test.ts` | 2 | 11 | `GitLab capability catalog`; `GitLab tool surface` |
| `tests/gitlab-service-boundary.test.ts` | `tests/gitlab/service-boundary.test.ts` | 1 | 3 | `GitLab boundary matching` |
| `tests/gitlab-service-credentials.test.ts` | `tests/gitlab/service-credentials.test.ts` | 1 | 17 | `GitLab managed service credentials` |
| `tests/gitlab-service.helpers.ts` | `tests/gitlab/service.helpers.ts` | — | — | fixture, в suite не собирается |
| `tests/provider-conformance.helpers.ts` | `tests/helpers/provider-conformance.helpers.ts` | — | — | fixture, в suite не собирается |
| `tests/plugin.test.ts` | `tests/host/plugin.test.ts` | 1 | 9 | `integrations plugin entry` |
| `tests/jira-catalog.test.ts` | `tests/jira/catalog.test.ts` | 2 | 13 | `Jira capability catalog`; `Jira tool surface` |
| `tests/jira-service-boundary.test.ts` | `tests/jira/service-boundary.test.ts` | 1 | 5 | `Jira boundary matching` |
| `tests/jira-service-credentials.test.ts` | `tests/jira/service-credentials.test.ts` | 1 | 15 | `Jira managed service credentials` |
| `tests/jira-service.helpers.ts` | `tests/jira/service.helpers.ts` | — | — | fixture, в suite не собирается |
| `tests/provider-http.test.ts` | `tests/kernel/http.test.ts` | 3 | 15 | `fetchWithRetries`; `readBoundedJson`; `readBoundedText` |
| `tests/probe-provider.test.ts` | `tests/scripts/probe-provider.test.ts` | 5 | 18 | `probe-provider arguments`; `probe-provider configuration`; `probe-provider coverage`; `probe-provider dialer`; `probe-provider secrets` |
| `tests/service-credentials-broker-audit.test.ts` | `tests/service-credentials/broker-audit.test.ts` | 1 | 5 | `managed service credentials: broker` |
| `tests/broker-isolation.test.ts` | `tests/service-credentials/broker-isolation.test.ts` | 1 | 3 | `IntegrationBroker user isolation` |
| `tests/service-credentials-broker-secrets.test.ts` | `tests/service-credentials/broker-secrets.test.ts` | 1 | 7 | `managed service credentials: broker` |
| `tests/service-credentials-broker.test.ts` | `tests/service-credentials/broker.test.ts` | 1 | 10 | `managed service credentials: broker` |
| `tests/service-credentials-capability-state.test.ts` | `tests/service-credentials/capability-state.test.ts` | 1 | 1 | `managed service credentials: capability state` |
| `tests/service-credentials-config.test.ts` | `tests/service-credentials/config.test.ts` | 1 | 5 | `managed service credentials: configuration` |
| `tests/service-credentials.helpers.ts` | `tests/service-credentials/helpers.ts` | — | — | fixture, в suite не собирается |
| `tests/service-credentials-policy.test.ts` | `tests/service-credentials/policy.test.ts` | 1 | 7 | `managed service credentials: policy` |
| `tests/service-credentials-rate-limit.test.ts` | `tests/service-credentials/rate-limit.test.ts` | 3 | 29 | `service mode rate limiting > configuration`; `service mode rate limiting > the limiter`; `service mode rate limiting > through the broker` |
| `tests/credential-help.test.ts` | `tests/shared/credential-help.test.ts` | 3 | 11 | `credential help declarations`; `credential help over the remote`; `credential help resolution` |
| `tests/provider-health.test.ts` | `tests/shared/health.test.ts` | 1 | 10 | `healthFromFailure` |
| `tests/provider-payload.test.ts` | `tests/shared/payload.test.ts` | 6 | 25 | `arrayOf`; `booleanOf`; `compact`; `numberOf`; `recordOf`; `stringOf` |
| `tests/service-boundary.test.ts` | `tests/shared/service-boundary.test.ts` | 1 | 13 | `service credential: the provider's own lock` |
| `tests/repository-store.test.ts` | `tests/storage/repository-store.test.ts` | 3 | 10 | `IntegrationRepository audit retention`; `IntegrationRepository connections`; `IntegrationRepository import of the pre-SQLite file` |
| `tests/secret-store.test.ts` | `tests/storage/secret-store.test.ts` | 1 | 3 | `SecretStore` |
| `tests/teamcity-catalog.test.ts` | `tests/teamcity/catalog.test.ts` | 2 | 11 | `TeamCity capability catalog`; `TeamCity tool surface` |
| `tests/teamcity-service.test.ts` | `tests/teamcity/service.test.ts` | 2 | 16 | `TeamCity boundary matching`; `TeamCity managed service credentials` |
| `tests/testit-catalog.test.ts` | `tests/testit/catalog.test.ts` | 2 | 10 | `Test IT capability catalog`; `Test IT tool surface` |
| `tests/testit-service-credentials.test.ts` | `tests/testit/service-credentials.test.ts` | 2 | 25 | `Test IT boundary matching`; `Test IT managed service credentials` |
| `tests/catalog.test.ts` | `tests/tools/catalog.test.ts` | 4 | 14 | `Bitrix24 capability catalog`; `Bitrix24 tool surface`; `provider boundary`; `the mounted tools follow the providers a deployment enables` |
| `tests/tools-security.test.ts` | `tests/tools/security.test.ts` | 1 | 3 | `model-visible integration tools` |
| `tests/tool-service-ceiling.test.ts` | `tests/tools/service-ceiling.test.ts` | 1 | 9 | `integration tools: what the service ceiling refuses` |
| `tests/coerce.test.ts` | `tests/utils/coerce.test.ts` | 2 | 7 | `invalid`; `optionalChoice` |
| `tests/errors.test.ts` | `tests/utils/errors.test.ts` | 2 | 11 | `recoverableResource`; `scopedConfigError` |
| `tests/redaction.test.ts` | `tests/utils/redaction.test.ts` | 1 | 2 | `redaction` |
| `tests/weblate-catalog.test.ts` | `tests/weblate/catalog.test.ts` | 2 | 14 | `Weblate capability catalog`; `Weblate tool surface` |
| `tests/weblate-service-boundary.test.ts` | `tests/weblate/service-boundary.test.ts` | 1 | 14 | `Weblate service boundary` |
| `tests/weblate-service-credentials.test.ts` | `tests/weblate/service-credentials.test.ts` | 1 | 10 | `Weblate managed service credentials` |

Итого: 60 файлов, 85 `describe`, 534 кейса.

## Проверка

```bash
# снимок до переноса (на 63a5e697) и после, в каталоге пакета
npx nx run @yadsh/dsh-qa-integrations:build --skip-nx-cache
npx vitest run --reporter=json --outputFile=baseline.json    # до
npx vitest run --reporter=json --outputFile=after.json       # после
```

| команда | результат |
| --- | --- |
| `vitest run` (пакет, после переноса) | 119 файлов, 910 кейсов, 282 `describe`, 0 упавших — те же числа, что до переноса |
| сверка json-снимков по полным заголовкам | `rebasedRows=910 afterRows=910 keys=910/910 diffs=0 notPassed=0/0` |
| `pnpm --filter @yadsh/dsh-qa-integrations check` (lint, typecheck, test, build, verify:package) | зелёный |
| `node scripts/check-file-budget.mjs` | зелёный, перенос не изменил ни одного размера файла |
| `npx prettier --check` по затронутым файлам | зелёный |

Сверка снимков сопоставляет каждую строку отчёта как `путь :: полный заголовок
кейса` и требует равенства множеств после подстановки старой карты путей: так
пропадает и потерянный `it`, и тихо переименованный заголовок.

## Что осталось как было

- Тела тестов, фикстуры и ассерты. Изменены только пути файлов и относительные
  спецификаторы, которые эти пути разрешают (`../src/*` → `../../src/*`,
  `./service-credentials.helpers.js` → `./helpers.js`,
  `../provider-conformance.helpers.js` → `../helpers/provider-conformance.helpers.js`,
  глубина `REPOSITORY_ROOT` в `tests/scripts/probe-provider.test.ts` и путь к
  `lib/client.js` в `tests/client/client-bundle.test.tsx`).
- Семь provider-папок и `kernel/`: их содержимое не перекладывалось, только
  дополнено. Уже разложенные провайдеры повторно не переносились.
- Исходный код и публичный API: правки в `src/` — три комментария-ссылки на
  переехавшие тесты (`src/client/operator-service-reach.ts`, дважды) и путь в
  `src/providers/README.md`. Пути в `README.md`, `docs/specs/*` поправлены на
  актуальные.
- Массовых переименований исходников и тестовых selector'ов (#462–#464) проход
  не затрагивает: имена `data-testid` и тулчейн-спецификаторы не менялись.

## Координация

- Большой provider/kernel разрез (#295, #319) не повторяется: `kernel/` приняла
  только `provider-http.test.ts`, который читает `src/providers/kernel/read-policy.ts`.
- С #343, #433 и selector-карточками #462–#464 пересекается только содержимым
  файлов, не путями: перенос выполнен до их правок на этом срезе, и повторный
  перенос тех же файлов не требуется.
