import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { CredentialHelpNote } from "@yadsh/dsh-plugin-kit/client";
import { useState } from "react";
import type {
  CredentialSource,
  IntegrationInstanceSummary,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard, serviceConnectOption } from "./provider-card.js";

export interface JiraRemote {
  jiraSites(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getJira(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putJiraCredential(
    token: string,
    input: {
      readonly siteId: string;
      readonly email: string;
      readonly token: string;
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testJira(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchJiraPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectJira(token: string): Promise<RemoteResult<boolean>>;
  /**
   * The service remotes exist on the host for every provider; they stay
   * optional here so a card also renders against a slice that offers none of
   * them — the checkbox and the switches simply never appear.
   */
  managedServiceCredentials?(token: string): Promise<
    RemoteResult<{
      readonly enabled: boolean;
      readonly defaultForNewConnections: boolean;
    }>
  >;
  credentialSource?(
    token: string,
    input: { readonly provider: string; readonly source: CredentialSource },
  ): Promise<RemoteResult<IntegrationSummary>>;
  serviceBoundary?(
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
    "Проверьте API-токен, e-mail аккаунта Atlassian и выбранный сайт.",
  ProviderPermissionDenied:
    "Jira не разрешил это действие: задача, проект или поле закрыты правами вашего аккаунта.",
  ProviderUnavailable:
    "Jira недоступна с этого стенда. Проверьте адрес сайта, заданный оператором, и сетевую доступность.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked:
    "Jira отклонила токен. Создайте новый API-токен и замените его.",
  ResourceNotFound: "Jira не нашла ресурс или ваш аккаунт его не видит.",
  RateLimited: "Слишком много запросов к Jira. Попробуйте позже.",
  ResultTooLarge: "Ответ Jira слишком большой для одного запроса.",
  UpstreamTimeout: "Jira не ответила вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат сайта Jira не принят стендом. Нужен сертификат, которому доверяет сервер.",
  ServiceCredentialUnavailable:
    "Для этого сайта администратор не настроил сервисный токен.",
  ServiceCredentialDisabled:
    "Сервисный токен этого сайта отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для выбранного сайта. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный токен не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный токен не даёт доступа к этому проекту. Сузьте доступ в списке или подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface JiraExtra {
  readonly sites: readonly IntegrationInstanceSummary[];
  setSites(sites: readonly IntegrationInstanceSummary[]): void;
  readonly siteId: string;
  setSiteId(siteId: string): void;
  readonly email: string;
  setEmail(email: string): void;
}

export function createJiraCard(remote: JiraRemote) {
  return createProviderCard<JiraExtra>({
    title: "Jira",
    portalFallback: "Задачи, комментарии и вложения вашей Jira",
    accountFallback: "Пользователь Jira",
    errorCopy: ERROR_COPY,
    notGrantedText: "Выключено оператором стенда",
    futurePermissions: ["Создание и правка задач, комментарии, переходы"],
    useExtra: () => {
      const [sites, setSites] = useState<readonly IntegrationInstanceSummary[]>(
        [],
      );
      const [siteId, setSiteId] = useState("");
      const [email, setEmail] = useState("");
      return { sites, setSites, siteId, setSiteId, email, setEmail };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.jiraSites(token);
      if (list.ok) {
        extra.setSites(list.value);
        extra.setSiteId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getJira(token));
    },
    calls: {
      save: (token, credential, extra, options) =>
        remote.putJiraCredential(token, {
          siteId: extra.siteId,
          email: extra.email,
          token: credential,
          // The host spends the flag with the service connect; leaving it
          // undefined keeps a personal save's payload exactly what it was.
          useServiceCredential: options.useServiceCredential || undefined,
        }),
      test: (token) => remote.testJira(token),
      patch: (token, patch) => remote.patchJiraPolicy(token, patch),
      disconnect: (token) => remote.disconnectJira(token),
      setSource: (token, source) => {
        const call = remote.credentialSource;
        if (call === undefined) {
          return Promise.reject(
            new Error("This deployment does not offer service mode for Jira"),
          );
        }
        return call(token, { provider: "jira", source });
      },
      setBoundary: (token, selection) => {
        const call = remote.serviceBoundary;
        if (call === undefined) {
          return Promise.reject(
            new Error("This deployment does not offer service mode for Jira"),
          );
        }
        return call(token, { provider: "jira", selection });
      },
    },
    // Exactly the selected site's managed credential: falling back to another
    // site's would offer a checkbox whose connect could only fail.
    serviceBinding: (extra) => {
      if (extra.siteId === "") {
        return extra.sites.length === 1
          ? (extra.sites[0]?.service ?? null)
          : null;
      }
      return (
        extra.sites.find((site) => site.id === extra.siteId)?.service ?? null
      );
    },
    serviceDefault: async (token) => {
      const call = remote.managedServiceCredentials;
      if (call === undefined) return false;
      const result = await call(token);
      return result.ok
        ? result.value.enabled && result.value.defaultForNewConnections
        : false;
    },
    credentialSection: (state, help) => {
      const { sites, siteId, email } = state.extra;
      const configured = sites.length > 0;
      if (!configured) return null;
      const needsChoice = sites.length > 1;
      const service = serviceConnectOption(state);
      const sitePicker = needsChoice ? (
        <label className="dsh-qa-integrations__field">
          Сайт Jira
          <select
            className="dsh-qa-integrations__input"
            value={siteId}
            disabled={state.busy}
            onChange={(event) =>
              state.extra.setSiteId(event.currentTarget.value)
            }
          >
            <option value="">Выберите сайт</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="dsh-qa-integrations__muted">
          Сайт: {sites[0]?.label ?? ""} — задан оператором стенда
        </span>
      );
      // With a managed credential there is nothing to paste: the host spends the
      // deployment's token, so the form keeps the site picker and the checkbox
      // and drops the e-mail and secret fields entirely.
      if (state.useService) {
        return (
          <div className="dsh-qa-integrations__section">
            {sitePicker}
            {service}
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={state.busy || (needsChoice && siteId === "")}
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
          {service}
          {sitePicker}
          <label className="dsh-qa-integrations__field">
            Аккаунт Atlassian (e-mail)
            <input
              className="dsh-qa-integrations__input"
              type="email"
              autoComplete="off"
              value={email}
              disabled={state.busy}
              onChange={(event) =>
                state.extra.setEmail(event.currentTarget.value)
              }
              placeholder="ivan@example.com"
            />
          </label>
          <label className="dsh-qa-integrations__field">
            API-токен Jira
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
              placeholder="ATATT…"
            />
          </label>
          <CredentialHelpNote help={help} />
          <p className="dsh-qa-integrations__hint">
            Токен и e-mail хранятся в зашифрованном виде и после сохранения не
            отображаются.
          </p>
          <div className="dsh-qa-integrations__actions">
            <button
              className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
              type="button"
              disabled={
                state.busy ||
                state.credential.trim() === "" ||
                email.trim() === "" ||
                (needsChoice && siteId === "")
              }
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
    notConfiguredHint: () => (
      <p className="dsh-qa-integrations__hint">
        Оператор не настроил ни одного сайта Jira, подключать нечего. Адреса
        сайтов задаются в конфигурации развёртывания.
      </p>
    ),
  });
}
