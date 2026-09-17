import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useState } from "react";
import type {
  CredentialSource,
  IntegrationInstanceSummary,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard, serviceConnectOption } from "./provider-card.js";

export interface TeamcityRemote {
  getTeamcity(token: string): Promise<RemoteResult<IntegrationSummary>>;
  /**
   * The address this deployment dials, or null when it configured none. The
   * connect form shows it and never asks for it: the server one token is spent
   * against is stand-wide configuration, not a choice each user makes.
   */
  teamcityServer(
    token: string,
  ): Promise<RemoteResult<IntegrationInstanceSummary | null>>;
  putTeamcityCredential(
    token: string,
    input: {
      readonly token: string;
      readonly useServiceCredential?: boolean;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testTeamcity(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchTeamcityPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectTeamcity(token: string): Promise<RemoteResult<boolean>>;
  managedServiceCredentials(token: string): Promise<
    RemoteResult<{
      readonly enabled: boolean;
      readonly defaultForNewConnections: boolean;
    }>
  >;
  credentialSource(
    token: string,
    input: { readonly provider: string; readonly source: CredentialSource },
  ): Promise<RemoteResult<IntegrationSummary>>;
  serviceBoundary(
    token: string,
    input: {
      readonly provider: string;
      readonly selection: IntegrationServiceBoundary | null;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential:
    "Проверьте access token: адрес TeamCity задаёт оператор стенда.",
  ProviderPermissionDenied:
    "TeamCity не разрешил это действие: проверьте права токена на нужные проекты.",
  ProviderUnavailable:
    "TeamCity недоступен с этого стенда. Проверьте адрес, заданный оператором, и сетевую доступность.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked: "TeamCity отклонил токен. Создайте новый и замените его.",
  ResourceNotFound: "TeamCity не нашёл ресурс или токен его не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ TeamCity слишком большой для одного запроса.",
  UpstreamTimeout: "TeamCity не ответил вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат TeamCity не принят стендом. Нужен сертификат, которому доверяет сервер.",
  ServiceCredentialUnavailable:
    "Администратор не настроил сервисный токен для этого TeamCity.",
  ServiceCredentialDisabled:
    "Сервисный токен этого TeamCity отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для этого TeamCity. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный токен не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный токен не даёт доступа к этому проекту или сборке. Сузьте доступ в списке, укажите проект или подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface TeamcityExtra {
  /** undefined while the answer is on its way, null when this deployment
   * configured no address at all. */
  readonly server: IntegrationInstanceSummary | null | undefined;
  setServer(server: IntegrationInstanceSummary | null): void;
}

export function createTeamcityCard(remote: TeamcityRemote) {
  return createProviderCard<TeamcityExtra>({
    title: "TeamCity",
    portalFallback: "Сборки, тесты и причины падений вашего CI",
    accountFallback: "Пользователь TeamCity",
    errorCopy: ERROR_COPY,
    notGrantedText: "Выключено оператором стенда",
    futurePermissions: ["Запуск, отмена и комментарии к сборке"],
    useExtra: () => {
      const [server, setServer] = useState<
        IntegrationInstanceSummary | null | undefined
      >(undefined);
      return { server, setServer };
    },
    load: async ({ token, extra, accept, fail }) => {
      const address = await remote.teamcityServer(token);
      if (!address.ok) {
        fail(address.error);
        return;
      }
      extra.setServer(address.value);
      accept(await remote.getTeamcity(token));
    },
    serviceBinding: (extra) => extra.server?.service ?? null,
    serviceDefault: async (token) => {
      const result = await remote.managedServiceCredentials(token);
      return result.ok
        ? result.value.enabled && result.value.defaultForNewConnections
        : false;
    },
    calls: {
      save: (token, credential, _extra, options) =>
        remote.putTeamcityCredential(token, {
          token: credential,
          useServiceCredential: options.useServiceCredential,
        }),
      test: (token) => remote.testTeamcity(token),
      patch: (token, patch) => remote.patchTeamcityPolicy(token, patch),
      disconnect: (token) => remote.disconnectTeamcity(token),
      setSource: (token, source) =>
        remote.credentialSource(token, { provider: "teamcity", source }),
      setBoundary: (token, selection) =>
        remote.serviceBoundary(token, { provider: "teamcity", selection }),
    },
    credentialSection: (state) => {
      const server = state.extra.server;
      const configured = server !== null && server !== undefined;
      if (!configured) return null;
      const address = (
        <span className="dsh-qa-integrations__muted">
          Адрес TeamCity: {server.label ?? ""} — задан оператором стенда
        </span>
      );
      const service = serviceConnectOption(state);
      // A managed credential needs no token at all, so the form drops the field
      // and keeps only the instance line and the checkbox.
      if (state.useService) {
        return (
          <div className="dsh-qa-integrations__section">
            {address}
            {service}
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={state.busy}
                onClick={state.save}
              >
                Подключить сервисный токен
              </button>
              {state.connected ? (
                <button
                  className="dsh-qa-integrations__button"
                  type="button"
                  disabled={state.busy}
                  onClick={state.cancelCredential}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </div>
        );
      }
      return (
        <div className="dsh-qa-integrations__section">
          {address}
          {service}
          <label className="dsh-qa-integrations__field">
            Access token TeamCity
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
            />
          </label>
          <p className="dsh-qa-integrations__hint">
            Создайте в TeamCity (Profile → Access Tokens) токен с минимальными
            правами — «Limit per project» и только на чтение. Токен хранится в
            зашифрованном виде и после сохранения не отображается.
          </p>
          <div className="dsh-qa-integrations__actions">
            <button
              className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
              type="button"
              disabled={state.busy || state.credential.trim() === ""}
              onClick={state.save}
            >
              Сохранить и проверить
            </button>
            {state.connected ? (
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={state.busy}
                onClick={state.cancelCredential}
              >
                Отмена
              </button>
            ) : null}
          </div>
        </div>
      );
    },
    notConfiguredHint: (state) =>
      state.extra.server === null ? (
        <p className="dsh-qa-integrations__hint">
          Оператор не настроил адрес TeamCity, подключать нечего. Адрес стенда
          задаётся в конфигурации развёртывания — он один на всех.
        </p>
      ) : null,
  });
}
