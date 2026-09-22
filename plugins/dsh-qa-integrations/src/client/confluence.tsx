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

export interface ConfluenceRemote {
  confluenceSites(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getConfluence(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putConfluenceCredential(
    token: string,
    input: {
      readonly instanceId: string;
      /**
       * Absent on a Server / Data Center connect: such an instance accepts a
       * personal access token and needs no account at all.
       */
      readonly email?: string | undefined;
      readonly token: string;
      readonly useServiceCredential?: boolean;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testConfluence(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchConfluencePolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectConfluence(token: string): Promise<RemoteResult<boolean>>;
  /**
   * Present on the host that mounts the shared managed-credential machinery.
   * A caller without them gets a card that never offers service mode.
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
    "Проверьте адрес почты Atlassian, API token и выбранный сайт Confluence.",
  ProviderPermissionDenied:
    "Confluence не разрешил это действие: у аккаунта нет прав на страницу.",
  ProviderUnavailable: "Confluence сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialRevoked:
    "Confluence отклонил почту или токен. Выпустите новый токен и замените его.",
  ResourceNotFound: "Confluence не нашёл страницу или аккаунт её не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ Confluence слишком большой для одного запроса.",
  OperationDeniedByPolicy:
    "Пространство вне списка, разрешённого оператором стенда.",
  ServiceCredentialUnavailable:
    "Для этого сайта администратор не настроил сервисный токен.",
  ServiceCredentialDisabled:
    "Сервисный токен этого сайта отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для выбранного сайта. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный токен не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный режим читает только пространства из списка доступа. Сузьте запрос или подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface ConfluenceExtra {
  readonly sites: readonly IntegrationInstanceSummary[];
  setSites(sites: readonly IntegrationInstanceSummary[]): void;
  readonly instanceId: string;
  setInstanceId(instanceId: string): void;
  readonly email: string;
  setEmail(email: string): void;
}

export function createConfluenceCard(remote: ConfluenceRemote) {
  // The managed-credential calls are captured before the spec is built: they
  // may be absent on a host (or a fixture) that mounts no service machinery,
  // and the captured binding keeps the callbacks below honest about that.
  const credentialSource = remote.credentialSource;
  const serviceBoundary = remote.serviceBoundary;
  const managedServiceCredentials = remote.managedServiceCredentials;
  return createProviderCard<ConfluenceExtra>({
    title: "Confluence",
    portalFallback: "База знаний и документация вашей команды",
    accountFallback: "Пользователь Atlassian",
    errorCopy: ERROR_COPY,
    notGrantedText: "Выключено оператором стенда",
    futurePermissions: ["Создание и правка страниц, комментарии на запись"],
    useExtra: () => {
      const [sites, setSites] = useState<readonly IntegrationInstanceSummary[]>(
        [],
      );
      const [instanceId, setInstanceId] = useState("");
      const [email, setEmail] = useState("");
      return { sites, setSites, instanceId, setInstanceId, email, setEmail };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.confluenceSites(token);
      if (list.ok) {
        extra.setSites(list.value);
        extra.setInstanceId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getConfluence(token));
    },
    calls: {
      save: (token, credential, extra, options) => {
        // A Server / Data Center instance takes a personal access token and no
        // account, so the e-mail travels only when the form collected one —
        // the shape the deployment-managed path already sends. A Cloud save
        // carries the field exactly as this form always did.
        const email = extra.email;
        return remote.putConfluenceCredential(token, {
          instanceId: extra.instanceId,
          ...(email.trim() === "" ? {} : { email }),
          token: credential,
          // The personal form keeps the payload it always sent; the flag
          // travels only when the form asked for the managed credential.
          ...(options.useServiceCredential
            ? { useServiceCredential: true }
            : {}),
        });
      },
      test: (token) => remote.testConfluence(token),
      patch: (token, patch) => remote.patchConfluencePolicy(token, patch),
      disconnect: (token) => remote.disconnectConfluence(token),
      setSource:
        credentialSource === undefined
          ? undefined
          : (token, source) =>
              credentialSource(token, { provider: "confluence", source }),
      setBoundary:
        serviceBoundary === undefined
          ? undefined
          : (token, selection) =>
              serviceBoundary(token, { provider: "confluence", selection }),
    },
    // Exactly the selected site's managed credential: falling back to another
    // site's would offer a checkbox whose connect could only fail.
    serviceBinding: (extra) => {
      if (extra.instanceId === "") {
        return extra.sites.length === 1
          ? (extra.sites[0]?.service ?? null)
          : null;
      }
      return (
        extra.sites.find((site) => site.id === extra.instanceId)?.service ??
        null
      );
    },
    serviceDefault:
      managedServiceCredentials === undefined
        ? undefined
        : async (token) => {
            const result = await managedServiceCredentials(token);
            return (
              result.ok &&
              result.value.enabled &&
              result.value.defaultForNewConnections
            );
          },
    credentialSection: (state, help) => {
      const { sites, instanceId, email } = state.extra;
      const configured = sites.length > 0;
      if (!configured) return null;
      const needsChoice = sites.length > 1;
      const service = serviceConnectOption(state);
      // The instance the form would connect is what decides which fields it
      // asks for: Atlassian Cloud needs the account e-mail beside the API
      // token, a Server / Data Center instance needs a personal access token
      // and no account. Until one is picked the form keeps the Cloud shape,
      // which is the resolver's own default for an instance naming none.
      const selected =
        instanceId === ""
          ? sites.length === 1
            ? sites[0]
            : undefined
          : sites.find((site) => site.id === instanceId);
      const server = selected?.deploymentType === "server";
      const sitePicker = needsChoice ? (
        <label className="dsh-qa-integrations__field">
          Сайт Confluence
          <select
            className="dsh-qa-integrations__input"
            value={instanceId}
            disabled={state.busy}
            onChange={(event) =>
              state.extra.setInstanceId(event.currentTarget.value)
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
          Сайт: {sites[0]?.label ?? ""}
        </span>
      );
      const deployment = (
        <span className="dsh-qa-integrations__muted">
          Развёртывание: {server ? "Server / Data Center" : "Atlassian Cloud"}
        </span>
      );
      // With a managed credential there is nothing to paste: the host spends the
      // deployment's token, so the form keeps the site picker and the checkbox
      // and drops the e-mail and the secret field entirely.
      if (state.useService) {
        return (
          <div className="dsh-qa-integrations__section">
            {sitePicker}
            {deployment}
            {service}
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={state.busy || (needsChoice && instanceId === "")}
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
          {deployment}
          {server ? null : (
            <label className="dsh-qa-integrations__field">
              Почта аккаунта Atlassian
              <input
                className="dsh-qa-integrations__input"
                type="email"
                autoComplete="off"
                value={email}
                disabled={state.busy}
                onChange={(event) =>
                  state.extra.setEmail(event.currentTarget.value)
                }
                placeholder="user@example.com"
              />
            </label>
          )}
          <label className="dsh-qa-integrations__field">
            {server ? "Личный токен доступа (PAT)" : "Atlassian API token"}
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
              placeholder={server ? "Вставьте личный токен доступа" : "ATATT…"}
            />
          </label>
          <CredentialHelpNote help={help} />
          <p className="dsh-qa-integrations__hint">
            {server
              ? "Токен хранится в зашифрованном виде и после сохранения не отображается."
              : "Почта и токен хранятся в зашифрованном виде и после сохранения больше не отображаются."}
          </p>
          <div className="dsh-qa-integrations__actions">
            <button
              className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
              type="button"
              disabled={
                state.busy ||
                state.credential.trim() === "" ||
                (!server && email.trim() === "") ||
                (needsChoice && instanceId === "")
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
        Оператор не настроил ни одного сайта Confluence, подключать нечего.
      </p>
    ),
  });
}
